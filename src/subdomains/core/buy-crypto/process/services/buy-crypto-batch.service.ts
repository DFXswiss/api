import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementRuleStatus } from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceInvalidException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-invalid.exception';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { MissingBuyCryptoLiquidityException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';

@Injectable()
export class BuyCryptoBatchService {
  private readonly logger = new DfxLogger(BuyCryptoBatchService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly pricingService: PricingService,
    private readonly buyCryptoPricingService: BuyCryptoPricingService,
    private readonly fiatService: FiatService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly liquidityService: LiquidityManagementService,
    private readonly feeService: FeeService,
  ) {}

  async batchAndOptimizeTransactions(): Promise<void> {
    try {
      const search: FindOptionsWhere<BuyCrypto> = {
        outputReferenceAsset: { id: Not(IsNull()) },
        outputAsset: { type: Not(In([AssetType.CUSTOM, AssetType.PRESALE])) },
        outputAmount: IsNull(),
        priceDefinitionAllowedDate: Not(IsNull()),
        batch: IsNull(),
        inputReferenceAmountMinusFee: Not(IsNull()),
        status: In([
          BuyCryptoStatus.CREATED,
          BuyCryptoStatus.WAITING_FOR_LOWER_FEE,
          BuyCryptoStatus.PRICE_INVALID,
          BuyCryptoStatus.MISSING_LIQUIDITY,
        ]),
      };
      const txWithAssets = await this.buyCryptoRepo.find({
        where: [
          {
            ...search,
            cryptoInput: { status: In([PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED]) },
          },
          { ...search, cryptoInput: IsNull() },
        ],
        relations: {
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
          buy: { user: true },
          cryptoRoute: { user: true },
          transaction: { userData: true },
        },
      });

      if (txWithAssets.length === 0) return;

      this.logger.verbose(
        `Batching ${txWithAssets.length} buy-crypto transaction(s). Transaction ID(s): ${txWithAssets.map(
          (t) => t.id,
        )}`,
      );

      const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets);
      const batches = await this.createBatches(txWithReferenceAmount);

      for (const batch of batches) {
        const savedBatch = await this.buyCryptoBatchRepo.save(batch);
        this.logger.verbose(
          `Created buy-crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset.uniqueName}. Transaction(s) count ${batch.transactions.length}`,
        );
      }
    } catch (e) {
      this.logger.error('Error during buy-crypto batching:', e);
    }
  }

  private async defineReferenceAmount(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        if (tx.outputReferenceAmount) {
          tx.priceStepsObject = [
            ...tx.inputPriceStep,
            PriceStep.create(
              Config.manualPriceStepSourceName,
              tx.inputReferenceAsset,
              tx.outputReferenceAsset.name,
              tx.inputReferenceAmountMinusFee / tx.outputReferenceAmount,
            ),
          ];
        } else {
          const inputReferenceCurrency =
            tx.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(tx.inputReferenceAsset));

          const price = await this.pricingService.getPrice(inputReferenceCurrency, tx.outputReferenceAsset, false);

          tx.calculateOutputReferenceAmount(price);
        }

        for (const feeId of tx.usedFees?.split(';')) {
          await this.feeService.increaseTxUsages(tx.amountInChf, Number.parseInt(feeId), tx.userData);
        }
      } catch (e) {
        if (e instanceof PriceInvalidException) {
          await this.setPriceInvalidStatus([tx]);
        }

        this.logger.warn(`Could not calculate outputReferenceAmount for transaction ${tx.id}:`, e);
      }
    }

    return transactions.filter((tx) => tx.outputReferenceAmount);
  }

  private async createBatches(transactions: BuyCrypto[]): Promise<BuyCryptoBatch[]> {
    let batches: BuyCryptoBatch[] = [];

    batches = this.batchTransactions(transactions);
    batches = await this.filterOutExistingBatches(batches);
    batches = await this.optimizeBatches(batches);

    return batches;
  }

  private batchTransactions(transactions: BuyCrypto[]): BuyCryptoBatch[] {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset } = tx;

      let batch = batches.get(this.getBatchTempKey(outputReferenceAsset, outputAsset));

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({
          outputReferenceAsset,
          outputAsset,
          blockchain: outputAsset.blockchain,
          status: BuyCryptoBatchStatus.CREATED,
          transactions: [],
        });
        batches.set(this.getBatchTempKey(outputReferenceAsset, outputAsset), batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }

  private getBatchTempKey(outputReferenceAsset: Asset, outputAsset: Asset): string {
    const { dexName: targetDexName, blockchain, type } = outputAsset;
    const { dexName: referenceDexName } = outputReferenceAsset;

    return referenceDexName + '&' + targetDexName + '&' + blockchain + '&' + type;
  }

  private async filterOutExistingBatches(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    const filteredBatches: BuyCryptoBatch[] = [];

    for (const batch of batches) {
      const { outputAsset } = batch;

      const existingBatch = await this.buyCryptoBatchRepo.findOneBy({
        outputAsset: { id: outputAsset.id },
        status: Not(BuyCryptoBatchStatus.COMPLETE),
      });
      const newBatch = filteredBatches.find((b) => b.outputAsset.id === outputAsset.id);

      if (existingBatch || newBatch) {
        const txIds = batch.transactions.map((t) => t.id);

        this.logger.verbose(
          `Halting with creation of a new batch for asset: ${outputAsset.dexName}, existing batch for this asset is not complete yet. Transaction ID(s): ${txIds}`,
        );

        continue;
      }

      filteredBatches.push(batch);
    }

    return filteredBatches;
  }

  private async optimizeBatches(batches: BuyCryptoBatch[]): Promise<BuyCryptoBatch[]> {
    const optimizedBatches = [];

    for (const batch of batches) {
      try {
        const inputBatchLength = batch.transactions.length;

        const purchaseFee = await this.optimizeByLiquidity(batch);

        await this.optimizeByPayoutFee(batch);
        await this.optimizeByPurchaseFee(batch, purchaseFee);

        if (inputBatchLength !== batch.transactions.length) {
          this.logger.verbose(
            `Optimized batch for output asset ${batch.outputAsset.uniqueName}. ${
              inputBatchLength - batch.transactions.length
            } removed from the batch`,
          );
        }

        if (batch.transactions.length) optimizedBatches.push(batch);
      } catch (e) {
        const logLevel = e instanceof MissingBuyCryptoLiquidityException ? LogLevel.INFO : LogLevel.ERROR;
        this.logger.log(logLevel, `Error in optimizing new batch for ${batch.outputAsset.uniqueName}:`, e);
      }
    }

    return optimizedBatches;
  }

  // --- PAYOUT FEE OPTIMIZING --- //
  private async optimizeByPayoutFee(batch: BuyCryptoBatch) {
    const invalidTransactions: BuyCrypto[] = [];

    // add fee estimation
    for (const tx of batch.transactions) {
      try {
        const payoutFee = await this.getPayoutFee(tx);
        await this.buyCryptoRepo.updateFee(...tx.fee.addPayoutFeeEstimation(payoutFee, tx));
      } catch (e) {
        this.logger.error(`Error when optimizing by payout fee, buy_crypto id ${tx.id} is removed from batch:`, e);
        invalidTransactions.push(tx);
      }
    }

    // reset invalid transactions
    if (invalidTransactions.length) {
      batch.removeInvalidTransactions(invalidTransactions);
      await this.resetTransactionButKeepState(invalidTransactions);
    }

    // optimize
    const filteredOutTransactions = batch.optimizeByPayoutFeeEstimation();
    await this.setWaitingForLowerFeeStatus(filteredOutTransactions);
  }

  private async getPayoutFee(tx: BuyCrypto): Promise<number> {
    const nativePayoutFee = await this.payoutService.estimateFee(
      tx.outputAsset,
      tx.targetAddress,
      tx.outputReferenceAmount,
      tx.outputReferenceAsset,
    );

    return this.buyCryptoPricingService.getFeeAmountInRefAsset(tx.outputReferenceAsset, nativePayoutFee);
  }

  // ---- LIQUIDITY OPTIMIZING --- //

  private async optimizeByLiquidity(batch: BuyCryptoBatch): Promise<FeeResult> {
    const liquidity = await this.checkLiquidity(batch);

    try {
      const {
        purchaseFee,
        reference: { availableAmount, maxPurchasableAmount },
      } = liquidity;

      const isPurchaseRequired = batch.optimizeByLiquidity(availableAmount, maxPurchasableAmount);

      return isPurchaseRequired ? purchaseFee : { amount: 0, asset: purchaseFee.asset };
    } catch (e) {
      if (e instanceof MissingBuyCryptoLiquidityException) {
        await this.handleMissingBuyCryptoLiquidityException(batch, liquidity, e);
      }

      // re-throw by default to abort proceeding with batch
      throw e;
    }
  }

  private async checkLiquidity(batch: BuyCryptoBatch): Promise<CheckLiquidityResult> {
    try {
      const request = await this.createReadonlyLiquidityRequest(batch);

      return await this.dexService.checkLiquidity(request);
    } catch (e) {
      throw new Error(
        `Error in checking liquidity for a batch. Batch target asset: ${batch.outputAsset.uniqueName}. ${e.message}`,
      );
    }
  }

  private async createReadonlyLiquidityRequest(batch: BuyCryptoBatch): Promise<CheckLiquidityRequest> {
    const { outputAsset: targetAsset, outputReferenceAsset: referenceAsset } = batch;

    return {
      context: LiquidityOrderContext.BUY_CRYPTO,
      correlationId: 'not_required_for_readonly_liquidity_request',
      referenceAsset,
      referenceAmount: batch.outputReferenceAmount,
      targetAsset,
    };
  }

  private async handleMissingBuyCryptoLiquidityException(
    batch: BuyCryptoBatch,
    liquidity: CheckLiquidityResult,
    error: MissingBuyCryptoLiquidityException,
  ): Promise<void> {
    try {
      const {
        target: {
          amount: targetAmount,
          availableAmount: availableTargetAmount,
          maxPurchasableAmount: maxPurchasableTargetAmount,
        },
        reference: { availableAmount: availableReferenceAmount, maxPurchasableAmount: maxPurchasableReferenceAmount },
      } = liquidity;

      const { outputReferenceAmount, outputAsset: oa, outputReferenceAsset: ora, transactions } = batch;

      await this.setMissingLiquidityStatus(transactions);

      const targetDeficit = Util.round(targetAmount - availableTargetAmount, 8);
      const referenceDeficit = Util.round(outputReferenceAmount - availableReferenceAmount, 8);

      // order liquidity
      try {
        const asset = oa;
        const orderId = await this.liquidityService.buyLiquidity(asset.id, targetDeficit, true);
        this.logger.info(`Missing buy-crypto liquidity. Liquidity management order created: ${orderId}`);
      } catch (e) {
        this.logger.info(`Failed to order missing liquidity for asset ${oa.uniqueName}:`, e);

        // send missing liquidity message
        if (!e.message?.includes(LiquidityManagementRuleStatus.PROCESSING)) {
          const maxPurchasableTargetAmountMessage =
            maxPurchasableTargetAmount != null ? `, purchasable: ${maxPurchasableTargetAmount}` : '';

          const maxPurchasableReferenceAmountMessage =
            maxPurchasableReferenceAmount != null ? `, purchasable: ${maxPurchasableReferenceAmount}` : '';

          const messages = [
            `${error.message} Details:`,
            `Target: ${targetDeficit} ${oa.uniqueName} (required ${targetAmount}, available: ${availableTargetAmount}${maxPurchasableTargetAmountMessage})`,
            `Reference: ${referenceDeficit} ${ora.uniqueName} (required ${outputReferenceAmount}, available: ${availableReferenceAmount}${maxPurchasableReferenceAmountMessage})`,
            `Liquidity management order failed: ${e.message}`,
          ];

          await this.buyCryptoNotificationService.sendMissingLiquidityError(
            oa.dexName,
            oa.blockchain,
            oa.type,
            transactions.map((t) => t.id),
            messages,
          );
        }
      }
    } catch (e) {
      this.logger.error('Error in handling MissingBuyCryptoLiquidityException:', e);
    }
  }

  // --- PURCHASE FEE OPTIMIZATION -- ///
  private async optimizeByPurchaseFee(batch: BuyCryptoBatch, nativePurchaseFee: FeeResult) {
    try {
      const purchaseFee = await this.buyCryptoPricingService.getFeeAmountInRefAsset(
        batch.outputReferenceAsset,
        nativePurchaseFee,
      );

      batch.checkByPurchaseFeeEstimation(purchaseFee);
    } catch (e) {
      if (e instanceof FeeLimitExceededException) {
        await this.setWaitingForLowerFeeStatus(batch.transactions);
      }

      // re-throw by default to abort proceeding with batch
      throw e;
    }
  }

  // --- HELPER METHODS --- //
  private async setWaitingForLowerFeeStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.waitingForLowerFee());
    }
  }

  private async setPriceInvalidStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.setPriceInvalidStatus());
    }
  }

  private async setMissingLiquidityStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.setMissingLiquidityStatus());
    }
  }

  private async resetTransactionButKeepState(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      await this.buyCryptoRepo.update(...tx.resetTransactionButKeepState());
    }
  }
}
