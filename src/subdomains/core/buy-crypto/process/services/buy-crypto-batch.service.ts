import { ConflictException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AmountType, Util } from 'src/shared/utils/util';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { CryptoInputSettledStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceInvalidException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-invalid.exception';
import { PriceValidity, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { MissingBuyCryptoLiquidityException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoPricingService } from './buy-crypto-pricing.service';

// Deficits are in the target asset. Required and available amounts belong to THIS order, not to the batch the
// liquidity was checked for: on the deferred path the order covers a part of that batch only, so the
// whole-batch figures of the liquidity result would not add up with the deficit that is ordered.
interface MissingLiquidityOrder {
  transactions: BuyCrypto[];
  targetAsset: Asset;
  referenceAsset: Asset;
  minDeficit: number;
  deficit: number;
  requiredTargetAmount: number;
  requiredReferenceAmount: number;
  availableTargetAmount: number;
  availableReferenceAmount: number;
  reason: string;
}

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
    private readonly transactionAmlCheckService: TransactionAmlCheckService,
  ) {}

  async batchAndOptimizeTransactions(): Promise<void> {
    try {
      const search: FindOptionsWhere<BuyCrypto> = {
        outputReferenceAsset: { id: Not(IsNull()) },
        outputAsset: { type: Not(In([AssetType.CUSTOM, AssetType.PRESALE])) },
        priceDefinitionAllowedDate: Not(IsNull()),
        batch: IsNull(),
        chargebackAllowedDate: IsNull(),
        chargebackAllowedDateUser: IsNull(),
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
            cryptoInput: { status: In(CryptoInputSettledStatus) },
          },
          { ...search, cryptoInput: IsNull() },
        ],
        relations: {
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
          buy: { user: true },
          cryptoRoute: { user: true },
          transaction: { userData: true, request: true },
          liquidityPipeline: { orders: true },
        },
      });

      if (txWithAssets.length === 0) return;

      this.logger.verbose(
        `Batching ${txWithAssets.length} buy-crypto transaction(s). Transaction ID(s): ${txWithAssets.map(
          (t) => t.id,
        )}`,
      );

      const riskyTxs = txWithAssets.filter((t) => t.userData.isRiskBlocked || t.userData.isRiskBuyCryptoBlocked);
      for (const riskyTx of riskyTxs) {
        const previousAmlCheck = riskyTx.amlCheck;
        const previousAmlReason = riskyTx.amlReason;
        const previousStatus = riskyTx.status;
        const previousVersion = riskyTx.version;
        const [, update] = riskyTx.resetAmlCheck();
        const result = await this.buyCryptoRepo.update(
          {
            id: riskyTx.id,
            version: previousVersion,
            amlCheck: previousAmlCheck,
            amlReason: previousAmlReason === null || previousAmlReason === undefined ? IsNull() : previousAmlReason,
            status: previousStatus,
          },
          update,
        );
        if (result.affected !== 1) continue;
        await this.transactionAmlCheckService.createFromEntity(
          riskyTx,
          'BuyCrypto',
          AmlSourceType.RISK_BLOCK_RESET,
          previousAmlCheck,
          previousAmlReason,
        );
      }

      const filteredTx = txWithAssets.filter(
        (t) =>
          !t.userData.isSuspicious &&
          !t.userData.isRiskBlocked &&
          !t.userData.isRiskBuyCryptoBlocked &&
          (t.liquidityPipeline
            ? t.liquidityPipeline.isDone
            : !txWithAssets.some(
                (tx) => t.outputAsset.id === tx.outputAsset.id && tx.liquidityPipeline?.isDone === false,
              )),
      );

      const txWithReferenceAmount = await this.defineReferenceAmount(filteredTx);
      const batches = await this.createBatches(txWithReferenceAmount);

      for (const batch of batches) {
        const savedBatch = await this.saveBatchIfTransactionsUnchanged(batch);
        if (!savedBatch) continue;
        this.logger.verbose(
          `Created buy-crypto batch. Batch ID: ${savedBatch.id}. Asset: ${savedBatch.outputAsset.uniqueName}. Transaction(s) count ${batch.transactions.length}`,
        );
      }
    } catch (e) {
      this.logger.error('Error during buy-crypto batching:', e);
    }
  }

  private async saveBatchIfTransactionsUnchanged(batch: BuyCryptoBatch): Promise<BuyCryptoBatch | undefined> {
    return this.buyCryptoBatchRepo.manager.transaction(async (manager) => {
      for (const transaction of batch.transactions) {
        const claim = await manager.findOne(BuyCrypto, {
          where: {
            id: transaction.id,
            version: transaction.version,
            amlCheck: CheckStatus.PASS,
            status: In([
              BuyCryptoStatus.CREATED,
              BuyCryptoStatus.WAITING_FOR_LOWER_FEE,
              BuyCryptoStatus.PRICE_INVALID,
              BuyCryptoStatus.MISSING_LIQUIDITY,
            ]),
            priceDefinitionAllowedDate: Not(IsNull()),
            batch: IsNull(),
            isComplete: false,
          },
          select: { id: true },
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        });
        if (!claim) return undefined;
      }

      return manager.save(BuyCryptoBatch, batch);
    });
  }

  private async defineReferenceAmount(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        if (tx.outputReferenceAmount) {
          tx.priceStepsObject = [
            ...tx.inputPriceStep,
            PriceStep.create(
              Config.priceSourceManual,
              tx.inputReferenceAsset,
              tx.outputReferenceAsset.name,
              tx.inputReferenceAmountMinusFee / tx.outputReferenceAmount,
            ),
          ];
        } else {
          const inputReferenceCurrency =
            tx.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(tx.inputReferenceAsset));

          const price = await this.pricingService.getPrice(
            inputReferenceCurrency,
            tx.outputReferenceAsset,
            PriceValidity.VALID_ONLY,
          );

          const exchangeOrders =
            Config.liquidityManagement.usePipelinePriceForAllAssets && tx.liquidityPipeline
              ? await this.findAllExchangeOrders(tx.liquidityPipeline)
              : undefined;

          // Price from transaction request
          const quoteResult = !DisabledProcess(Process.GUARANTEED_PRICE)
            ? tx.transaction?.request?.calculateQuoteOutput(
                Config.txRequestValidityMinutes,
                tx.inputReferenceAmountMinusFee,
                price.price,
                AmountType.ASSET,
              )
            : undefined;

          if (quoteResult) {
            tx.outputReferenceAmount = quoteResult.outputAmount;
            tx.priceStepsObject = [...tx.inputPriceStep, ...quoteResult.priceSteps];
            tx.quoteMarketRatio = quoteResult.quoteMarketRatio;
          } else {
            tx.calculateOutputReferenceAmount(price, exchangeOrders);
          }
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

      // re-batching overwrites the batch reference amount, so the full demand has to be read before it —
      // without it the share of the deferred transactions can no longer be derived from the liquidity result
      const requestedReferenceAmount = batch.outputReferenceAmount;

      const { isPurchaseRequired, deferredTransactions } = batch.optimizeByLiquidity(
        availableAmount,
        maxPurchasableAmount,
      );

      await this.handleDeferredTransactions(batch, deferredTransactions, liquidity, requestedReferenceAmount);

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
        target: { amount: targetAmount, availableAmount: availableTargetAmount },
        reference: { availableAmount: availableReferenceAmount },
      } = liquidity;

      const { outputReferenceAmount, outputAsset, outputReferenceAsset, transactions } = batch;

      const minTargetAmount = batch.smallestTransaction.calculateOutputAmount(outputReferenceAmount, targetAmount);

      if (!(await this.setMissingLiquidityStatus(transactions))) return;

      // this order covers the whole batch, so the amounts of the liquidity result are the amounts of the order
      await this.orderMissingLiquidity(
        {
          transactions,
          targetAsset: outputAsset,
          referenceAsset: outputReferenceAsset,
          minDeficit: Util.round(minTargetAmount - availableTargetAmount, 8),
          deficit: Util.round(targetAmount - availableTargetAmount, 8),
          requiredTargetAmount: targetAmount,
          requiredReferenceAmount: outputReferenceAmount,
          availableTargetAmount,
          availableReferenceAmount,
          reason: error.message,
        },
        liquidity,
      );
    } catch (e) {
      this.logger.error('Error in handling MissingBuyCryptoLiquidityException:', e);
    }
  }

  /**
   * Transactions the available liquidity does not cover are dropped from the batch by `optimizeByLiquidity`.
   * Dropping alone leaves them without status, liquidity order or trace: the next cycle re-reads them and the
   * ascending sort hands the liquidity to every smaller transaction of the same asset again, so the largest one
   * can starve for hours while smaller batches of the same asset are paid out. Putting them into
   * MissingLiquidity and ordering the deficit for exactly this set is what ends that.
   *
   * Assigning a liquidity pipeline pauses the whole output asset — the pipeline filter in
   * `batchAndOptimizeTransactions` skips every transaction of an asset that has a pipeline still running. That
   * pause is intended: it keeps newly arriving smaller buys from consuming the liquidity bought for the
   * deferred set. It now starts with the first drop instead of hours later.
   *
   * Never throws: the sub-batch the liquidity does cover has to proceed in the same cycle.
   */
  private async handleDeferredTransactions(
    batch: BuyCryptoBatch,
    deferredTransactions: BuyCrypto[],
    liquidity: CheckLiquidityResult,
    requestedReferenceAmount: number,
  ): Promise<void> {
    if (!deferredTransactions.length) return;

    try {
      const {
        target: { amount: requestedTargetAmount, availableAmount: availableTargetAmount },
        reference: { availableAmount: availableReferenceAmount },
      } = liquidity;

      const { outputAsset, outputReferenceAsset } = batch;

      this.logger.info(
        `Deferring ${deferredTransactions.length} buy-crypto transaction(s) of asset ${
          outputAsset.uniqueName
        } to missing liquidity. Transaction ID(s): ${deferredTransactions.map((t) => t.id)}`,
      );

      // all amounts have to be read before the status is set: setMissingLiquidityStatus resets
      // outputReferenceAmount on the transactions, and the deficit cannot be sized from reset amounts
      //
      // liquidity was checked for the whole batch, so target amounts are shares of the requested reference
      // amount; the sub-batch that stays consumes its share first and only the rest is left for this set
      const deferredReferenceAmount = Util.round(Util.sumObjValue(deferredTransactions, 'outputReferenceAmount'), 8);
      const deferredTargetAmount = Util.round(
        Util.sum(
          deferredTransactions.map((t) => t.calculateOutputAmount(requestedReferenceAmount, requestedTargetAmount)),
        ),
        8,
      );
      const minTargetAmount = Util.minObj(deferredTransactions, 'outputReferenceAmount').calculateOutputAmount(
        requestedReferenceAmount,
        requestedTargetAmount,
      );
      const keptTargetAmount = Util.round(requestedTargetAmount - deferredTargetAmount, 8);
      const residualTargetAmount = Math.max(Util.round(availableTargetAmount - keptTargetAmount, 8), 0);

      // the reference side is what the notification reports the deficit in, and it has to be the residual of
      // this set as well - the whole-batch availability belongs to a demand this order does not carry
      const keptReferenceAmount = Util.round(requestedReferenceAmount - deferredReferenceAmount, 8);
      const residualReferenceAmount = Math.max(Util.round(availableReferenceAmount - keptReferenceAmount, 8), 0);

      const order: MissingLiquidityOrder = {
        transactions: deferredTransactions,
        targetAsset: outputAsset,
        referenceAsset: outputReferenceAsset,
        minDeficit: Util.round(minTargetAmount - residualTargetAmount, 8),
        deficit: Util.round(deferredTargetAmount - residualTargetAmount, 8),
        requiredTargetAmount: deferredTargetAmount,
        requiredReferenceAmount: deferredReferenceAmount,
        availableTargetAmount: residualTargetAmount,
        availableReferenceAmount: residualReferenceAmount,
        reason: `Not enough liquidity for all ${outputAsset.uniqueName} buy-crypto transactions, ${deferredTransactions.length} transaction(s) deferred.`,
      };

      if (!(await this.setMissingLiquidityStatus(deferredTransactions))) return;

      await this.orderMissingLiquidity(order, liquidity);
    } catch (e) {
      this.logger.error(`Error in handling deferred buy-crypto transactions for ${batch.outputAsset.uniqueName}:`, e);
    }
  }

  private async orderMissingLiquidity(order: MissingLiquidityOrder, liquidity: CheckLiquidityResult): Promise<void> {
    const {
      transactions,
      targetAsset,
      referenceAsset,
      minDeficit,
      deficit,
      requiredTargetAmount,
      requiredReferenceAmount,
      availableTargetAmount,
      availableReferenceAmount,
      reason,
    } = order;

    // only the purchasable amounts come from the liquidity result: they are a property of the venue and do not
    // belong to any one order, while required and available amounts have to describe the order that is placed
    const {
      target: { maxPurchasableAmount: maxPurchasableTargetAmount },
      reference: { maxPurchasableAmount: maxPurchasableReferenceAmount },
    } = liquidity;

    try {
      await this.buyCryptoRepo.manager.transaction(async (manager) => {
        for (const transaction of transactions) {
          const locked = await manager.findOne(BuyCrypto, {
            where: {
              id: transaction.id,
              version: transaction.version,
              amlCheck: CheckStatus.PASS,
              status: BuyCryptoStatus.MISSING_LIQUIDITY,
              batch: IsNull(),
              isComplete: false,
            },
            select: { id: true },
            loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) return;
        }

        const pipeline = await this.liquidityService.buyLiquidity(targetAsset.id, minDeficit, deficit, true);
        this.logger.info(
          `Missing buy-crypto liquidity. Liquidity management order created: ${
            pipeline.id
          }. Transaction ID(s): ${transactions.map((t) => t.id)}`,
        );

        const result = await manager.update(
          BuyCrypto,
          {
            id: In(transactions.map((transaction) => transaction.id)),
            amlCheck: CheckStatus.PASS,
            status: BuyCryptoStatus.MISSING_LIQUIDITY,
            batch: IsNull(),
            isComplete: false,
          },
          { liquidityPipeline: pipeline },
        );
        if (result.affected !== transactions.length) throw new Error('BuyCrypto changed before pipeline assignment');
      });
    } catch (e) {
      this.logger.info(`Failed to order missing liquidity for asset ${targetAsset.uniqueName}:`, e);

      // Send the missing liquidity message, unless the rule state is what refused the order. executeRule
      // raises ConflictException for exactly that - a rule that is Processing while its pipeline runs, or
      // Paused for the whole reactivation window after one failed. Neither is news: a running pipeline is the
      // throttle, and the pipeline that failed already mailed its failure. Matching on the message text
      // (Processing only) let the Paused window through, and since the deferred path re-orders for its set on
      // every cycle, that was a mail per minute for as long as the rule stayed paused. The transactions do not
      // go quiet: they hold MissingLiquidity, the bc-payout-missing-liquidity ops rule reports them, and the
      // refusal is logged above.
      if (!(e instanceof ConflictException)) {
        const maxPurchasableTargetAmountMessage =
          maxPurchasableTargetAmount != null ? `, purchasable: ${maxPurchasableTargetAmount}` : '';

        const referenceDeficit = Util.round(requiredReferenceAmount - availableReferenceAmount, 8);
        const maxPurchasableReferenceAmountMessage =
          maxPurchasableReferenceAmount != null ? `, purchasable: ${maxPurchasableReferenceAmount}` : '';

        const messages = [
          `${reason} Details:`,
          `Target: ${deficit} ${targetAsset.uniqueName} (required ${requiredTargetAmount}, available: ${availableTargetAmount}${maxPurchasableTargetAmountMessage})`,
          `Reference: ${referenceDeficit} ${referenceAsset.uniqueName} (required ${requiredReferenceAmount}, available: ${availableReferenceAmount}${maxPurchasableReferenceAmountMessage})`,
          `Liquidity management order failed: ${e.message}`,
        ];

        await this.buyCryptoNotificationService.sendMissingLiquidityError(
          targetAsset.dexName,
          targetAsset.blockchain,
          targetAsset.type,
          transactions.map((t) => t.id),
          messages,
        );
      }
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

  private async findAllExchangeOrders(
    pipeline: LiquidityManagementPipeline,
    maxDepth = 5,
  ): Promise<LiquidityManagementOrder[]> {
    if (maxDepth <= 0) return [];

    const orders: LiquidityManagementOrder[] = [];

    // Collect exchange orders from this pipeline
    const exchangeOrders = pipeline.exchangeOrders;
    orders.push(...exchangeOrders);

    // Recursively collect from sub-pipelines
    const subPipelineOrders = pipeline.subPipelineOrders;
    for (const subPipelineOrder of subPipelineOrders) {
      const subPipelineId = parseInt(subPipelineOrder.correlationId, 10);
      if (isNaN(subPipelineId)) continue;

      const subPipeline = await this.liquidityService.getPipelineWithOrders(subPipelineId);
      if (!subPipeline) continue;

      const subOrders = await this.findAllExchangeOrders(subPipeline, maxDepth - 1);
      orders.push(...subOrders);
    }

    return orders;
  }

  private async setWaitingForLowerFeeStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      const previousStatus = tx.status;
      const previousVersion = tx.version;
      const [, update] = tx.waitingForLowerFee();
      const result = await this.buyCryptoRepo.update(
        { id: tx.id, version: previousVersion, amlCheck: CheckStatus.PASS, status: previousStatus },
        update,
      );
      if (result.affected === 1 && previousVersion !== undefined) tx.version = previousVersion + 1;
    }
  }

  private async setPriceInvalidStatus(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      const previousStatus = tx.status;
      const previousVersion = tx.version;
      const [, update] = tx.setPriceInvalidStatus();
      const result = await this.buyCryptoRepo.update(
        { id: tx.id, version: previousVersion, amlCheck: CheckStatus.PASS, status: previousStatus },
        update,
      );
      if (result.affected === 1 && previousVersion !== undefined) tx.version = previousVersion + 1;
    }
  }

  private async setMissingLiquidityStatus(transactions: BuyCrypto[]): Promise<boolean> {
    for (const tx of transactions) {
      // write on transition only: the ops rule for stuck MissingLiquidity transactions measures their age, and
      // re-writing the same status on every cycle keeps the row young enough to never become overdue
      if (tx.isMissingLiquidity) continue;

      const previousStatus = tx.status;
      const previousVersion = tx.version;
      const [, update] = tx.setMissingLiquidityStatus();
      const result = await this.buyCryptoRepo.update(
        { id: tx.id, version: previousVersion, amlCheck: CheckStatus.PASS, status: previousStatus },
        update,
      );
      if (result.affected !== 1) return false;
      if (previousVersion !== undefined) tx.version = previousVersion + 1;
    }
    return true;
  }

  private async resetTransactionButKeepState(transactions: BuyCrypto[]): Promise<void> {
    for (const tx of transactions) {
      const previousStatus = tx.status;
      const previousVersion = tx.version;
      const [, update] = tx.resetTransactionButKeepState();
      const result = await this.buyCryptoRepo.update(
        { id: tx.id, version: previousVersion, amlCheck: CheckStatus.PASS, status: previousStatus },
        update,
      );
      if (result.affected === 1 && previousVersion !== undefined) tx.version = previousVersion + 1;
    }
  }
}
