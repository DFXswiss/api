import { Injectable } from '@nestjs/common';
import { TransactionResponse } from 'alchemy-sdk';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmGasPriceService } from 'src/integration/blockchain/shared/evm/evm-gas-price.service';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Equal, LessThan } from 'typeorm';
import {
  PaymentLinkEvmHexPaymentDto,
  TransferAmount,
  TransferAmountAsset,
  TransferInfo,
} from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import { PaymentLinkEvmHexPaymentStatus, PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentQuoteRepository } from '../repositories/payment-quote.repository';

@Injectable()
export class PaymentQuoteService {
  private readonly logger = new DfxLogger(PaymentQuoteService);

  static readonly PREFIX_UNIQUE_ID = 'plq';

  private readonly transferAmountOrder: Blockchain[] = [
    Blockchain.LIGHTNING,
    Blockchain.ETHEREUM,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.BASE,
    Blockchain.POLYGON,
    Blockchain.MONERO,
  ];

  private static readonly DEFAULT_TIMEOUT = 300;

  private readonly paymentStandardTimeoutSecondsMap = new Map<PaymentStandard, number>([
    [PaymentStandard.OPEN_CRYPTO_PAY, PaymentQuoteService.DEFAULT_TIMEOUT],
    [PaymentStandard.FRANKENCOIN_PAY, PaymentQuoteService.DEFAULT_TIMEOUT],
    [PaymentStandard.LIGHTNING_BOLT11, PaymentQuoteService.DEFAULT_TIMEOUT],
    [PaymentStandard.PAY_TO_ADDRESS, 7200],
  ]);

  private static readonly DEFAULT_FEE = 0.01;

  private readonly paymentStandardFeeMap = new Map<PaymentStandard, number>([
    [PaymentStandard.OPEN_CRYPTO_PAY, PaymentQuoteService.DEFAULT_FEE],
    [PaymentStandard.FRANKENCOIN_PAY, PaymentQuoteService.DEFAULT_FEE],
    [PaymentStandard.LIGHTNING_BOLT11, PaymentQuoteService.DEFAULT_FEE],
    [PaymentStandard.PAY_TO_ADDRESS, 0.02],
  ]);

  constructor(
    private paymentQuoteRepo: PaymentQuoteRepository,
    private readonly evmRegistryService: EvmRegistryService,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
    private readonly evmGasPriceService: EvmGasPriceService,
  ) {}

  async processActualQuotes(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const actualPaymentLinkQuotes = await this.paymentQuoteRepo.findBy({
      status: PaymentQuoteStatus.ACTUAL,
      expiryDate: LessThan(maxDate),
    });

    for (const actualPaymentLinkQuote of actualPaymentLinkQuotes) {
      await this.paymentQuoteRepo.save(actualPaymentLinkQuote.expire());
    }
  }

  async checkTxConfirmations(): Promise<void> {
    const blockchainPaymentLinkQuotes = await this.paymentQuoteRepo.findBy({
      status: PaymentQuoteStatus.TX_BLOCKCHAIN,
    });

    for (const blockchainPaymentLinkQuote of blockchainPaymentLinkQuotes) {
      const blockchain = blockchainPaymentLinkQuote.txBlockchain;

      if (blockchain) {
        const minNumberOfConfirmations = blockchain === Blockchain.ETHEREUM ? 6 : 100;

        const client = this.evmRegistryService.getClient(blockchain);
        const isTxComplete = await client.isTxComplete(blockchainPaymentLinkQuote.txId, minNumberOfConfirmations);

        if (isTxComplete) await this.saveFinallyConfirmed(blockchainPaymentLinkQuote.uniqueId);
      }
    }
  }

  async getActualQuote(paymentId: number, transferInfo: TransferInfo): Promise<PaymentQuote | undefined> {
    return transferInfo.quoteUniqueId
      ? this.getActualQuoteByUniqueId(transferInfo.quoteUniqueId) ?? undefined
      : this.getActualQuoteByPaymentId(paymentId, transferInfo);
  }

  private async getActualQuoteByUniqueId(uniqueId: string): Promise<PaymentQuote | null> {
    return this.paymentQuoteRepo.findOne({
      where: {
        uniqueId: Equal(uniqueId),
        status: PaymentQuoteStatus.ACTUAL,
      },
    });
  }

  private async getActualQuoteByPaymentId(
    paymentId: number,
    transferInfo: TransferInfo,
  ): Promise<PaymentQuote | undefined> {
    const actualQuotes = await this.paymentQuoteRepo.find({
      where: {
        payment: { id: Equal(paymentId) },
        status: PaymentQuoteStatus.ACTUAL,
      },
      order: { expiryDate: 'DESC' },
    });

    return actualQuotes.find((aq) =>
      aq.isTransferAmountAsset(transferInfo.method, transferInfo.asset, transferInfo.amount),
    );
  }

  async getAmountFromQuote(actualQuote: PaymentQuote, transferInfo: TransferInfo): Promise<number | undefined> {
    const transferAmountAsset = actualQuote.getTransferAmountFor(transferInfo.method, transferInfo.asset);
    return transferAmountAsset?.amount;
  }

  async createQuote(standard: PaymentStandard, payment: PaymentLinkPayment): Promise<PaymentQuote> {
    const timeoutSeconds = this.paymentStandardTimeoutSecondsMap.get(standard) ?? PaymentQuoteService.DEFAULT_TIMEOUT;

    const quote = this.paymentQuoteRepo.create({
      uniqueId: Util.createUniqueId(PaymentQuoteService.PREFIX_UNIQUE_ID),
      status: PaymentQuoteStatus.ACTUAL,
      transferAmounts: await this.createTransferAmounts(standard, payment).then(JSON.stringify),
      expiryDate: Util.secondsAfter(timeoutSeconds),
      standard,
      payment,
    });

    return this.paymentQuoteRepo.save(quote);
  }

  private async createTransferAmounts(
    standard: PaymentStandard,
    payment: PaymentLinkPayment,
  ): Promise<TransferAmount[]> {
    const transferAmounts: TransferAmount[] = [];

    const paymentAssetMap = await this.createOrderedPaymentAssetMap(payment.link.configObj.blockchains);

    for (const [blockchain, assets] of paymentAssetMap.entries()) {
      const transferAmount = await this.createTransferAmount(standard, payment, blockchain, assets);

      if (transferAmount.assets.length) transferAmounts.push(transferAmount);
    }

    return transferAmounts;
  }

  private async createTransferAmount(
    standard: PaymentStandard,
    payment: PaymentLinkPayment,
    blockchain: Blockchain,
    assets: Asset[],
  ): Promise<TransferAmount> {
    const minFee = await this.getMinFee(blockchain);

    const transferAmount: TransferAmount = {
      method: blockchain,
      minFee: minFee,
      assets: [],
    };

    if (minFee != null) {
      for (const asset of assets) {
        const transferAmountAsset = await this.getTransferAmountAsset(
          standard,
          payment.currency,
          asset,
          payment.amount,
        );
        if (transferAmountAsset) transferAmount.assets.push(transferAmountAsset);
      }
    }

    return transferAmount;
  }

  private async getMinFee(blockchain: Blockchain): Promise<number | undefined> {
    if (blockchain === Blockchain.LIGHTNING) return 0;

    return this.evmGasPriceService.getGasPrice(blockchain);
  }

  private async createOrderedPaymentAssetMap(blockchains: Blockchain[]): Promise<Map<Blockchain, Asset[]>> {
    const paymentAssets = await this.assetService.getPaymentAssets();

    const availableAssets = paymentAssets
      .filter((a) => blockchains.includes(a.blockchain))
      .sort((a, b) => this.getBlockchainSortOrder(a.blockchain) - this.getBlockchainSortOrder(b.blockchain));

    return Util.groupBy<Asset, Blockchain>(availableAssets, 'blockchain');
  }

  private getBlockchainSortOrder(blockchain: Blockchain): number {
    const index = this.transferAmountOrder.indexOf(blockchain);
    return index < 0 ? Infinity : index;
  }

  private async getTransferAmountAsset(
    standard: PaymentStandard,
    currency: Fiat,
    asset: Asset,
    amount: number,
  ): Promise<TransferAmountAsset | undefined> {
    const transferAmount = await this.getTransferAmount(standard, currency, asset, amount);
    if (!transferAmount) return;

    const decimals = asset.decimals ?? 18;

    return {
      asset: asset.name,
      amount: Util.round(transferAmount, decimals),
    };
  }

  private async getTransferAmount(
    standard: PaymentStandard,
    currency: Fiat,
    asset: Asset,
    amount: number,
  ): Promise<number | undefined> {
    if (currency.name === 'CHF' && asset.name === 'ZCHF') return amount;

    try {
      const price = await this.pricingService.getPrice(asset, currency, true);
      const fee = this.paymentStandardFeeMap.get(standard) ?? PaymentQuoteService.DEFAULT_FEE;

      return price.invert().convert(amount / (1 - fee), 8);
    } catch (e) {
      this.logger.error(`Quote: Failed to get price of currency ${currency.name} and asset ${asset.uniqueName}`, e);
    }
  }

  async cancel(paymentId: number): Promise<void> {
    const actualQuotes = await this.paymentQuoteRepo.find({
      where: { payment: { id: paymentId }, status: PaymentQuoteStatus.ACTUAL },
    });

    for (const actualQuote of actualQuotes) {
      await this.paymentQuoteRepo.save(actualQuote.cancel());
    }
  }

  async executeHexPayment(_uniqueId: string, transferInfo: TransferInfo): Promise<PaymentLinkEvmHexPaymentDto> {
    try {
      await this.saveTransaction(transferInfo.quoteUniqueId, transferInfo.method, transferInfo.hex);

      const evmClient = this.evmRegistryService.getClient(transferInfo.method);
      const transactionResponse = await evmClient.sendSignedTransaction(transferInfo.hex);

      return transactionResponse.error
        ? await this.handleHexTransactionError(transferInfo, transactionResponse.error)
        : await this.handleHexTransactionResponse(transferInfo, transactionResponse.response);
    } catch (e) {
      this.logger.error(`Transaction failed for quote ${transferInfo.quoteUniqueId}:`, e);

      const errorMessage = e.message ?? 'Transaction failed';

      return this.handleHexTransactionError(transferInfo, { code: -1, message: errorMessage });
    }
  }

  private async handleHexTransactionError(
    transferInfo: TransferInfo,
    transactionError: { code: number; message: string },
  ): Promise<PaymentLinkEvmHexPaymentDto> {
    const errorMessage = transactionError.message;

    await this.saveErrorMessage(transferInfo.quoteUniqueId, errorMessage);

    return this.createPaymentLinkEvmHexPayment(transferInfo, PaymentLinkEvmHexPaymentStatus.FAILED, errorMessage);
  }

  private async handleHexTransactionResponse(
    transferInfo: TransferInfo,
    transactionResponse: TransactionResponse,
  ): Promise<PaymentLinkEvmHexPaymentDto> {
    const txId = transactionResponse.hash;
    await this.saveMempoolAccepted(transferInfo.quoteUniqueId, txId);

    const message = 'Transaction successfully sent to mempool';
    return this.createPaymentLinkEvmHexPayment(transferInfo, PaymentLinkEvmHexPaymentStatus.SUCCESS, message, txId);
  }

  private createPaymentLinkEvmHexPayment(
    transferInfo: TransferInfo,
    status: PaymentLinkEvmHexPaymentStatus,
    message: string,
    txId?: string,
  ) {
    return {
      blockchain: transferInfo.method,
      amount: transferInfo.amount,
      asset: transferInfo.asset,
      status,
      message,
      txId,
    };
  }

  private async saveTransaction(uniqueId: string, txBlockchain: Blockchain, tx: string): Promise<void> {
    await this.paymentQuoteRepo.update({ uniqueId }, { status: PaymentQuoteStatus.TX_RECEIVED, txBlockchain, tx });
  }

  private async saveMempoolAccepted(uniqueId: string, txId: string): Promise<void> {
    await this.paymentQuoteRepo.update({ uniqueId }, { status: PaymentQuoteStatus.TX_MEMPOOL, txId });
  }

  async saveBlockchainConfirmed(blockchain: Blockchain, txId: string): Promise<void> {
    const status =
      blockchain === Blockchain.LIGHTNING ? PaymentQuoteStatus.TX_FINALLY : PaymentQuoteStatus.TX_BLOCKCHAIN;

    await this.paymentQuoteRepo.update({ txId }, { status });
  }

  private async saveFinallyConfirmed(uniqueId: string): Promise<void> {
    await this.paymentQuoteRepo.update({ uniqueId }, { status: PaymentQuoteStatus.TX_FINALLY });
  }

  private async saveErrorMessage(uniqueId: string, errorMessage: string): Promise<void> {
    await this.paymentQuoteRepo.update({ uniqueId }, { status: PaymentQuoteStatus.TX_FAILED, errorMessage });
  }
}
