import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { Equal, In, LessThan } from 'typeorm';
import { TransferAmount, TransferAmountAsset, TransferInfo } from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import {
  PaymentActivationStatus,
  PaymentLinkPaymentStatus,
  PaymentQuoteStatus,
  PaymentQuoteTxStates,
  PaymentStandard,
} from '../enums';
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
    private readonly paymentQuoteRepo: PaymentQuoteRepository,
    private readonly evmRegistryService: EvmRegistryService,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
    private readonly evmGasPriceService: EvmGasPriceService,
  ) {}

  // --- JOBS --- //
  async processExpiredQuotes(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const actualPaymentLinkQuotes = await this.paymentQuoteRepo.findBy({
      status: PaymentQuoteStatus.ACTUAL,
      expiryDate: LessThan(maxDate),
    });

    for (const actualPaymentLinkQuote of actualPaymentLinkQuotes) {
      await this.paymentQuoteRepo.save(actualPaymentLinkQuote.expire());
    }
  }

  // --- CRUD --- //
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
    const standard = transferInfo.standard ?? PaymentStandard.OPEN_CRYPTO_PAY;

    const actualQuotes = await this.paymentQuoteRepo.find({
      where: {
        payment: { id: Equal(paymentId) },
        status: Equal(PaymentQuoteStatus.ACTUAL),
        standard: Equal(standard),
      },
      order: { expiryDate: 'DESC' },
    });

    return actualQuotes.find((aq) =>
      aq.isTransferAmountAsset(transferInfo.method, transferInfo.asset, transferInfo.amount),
    );
  }

  async getQuoteByAsset(asset: Asset, amount: number): Promise<PaymentQuote | null> {
    return this.paymentQuoteRepo.findOne({
      where: {
        activations: {
          status: PaymentActivationStatus.OPEN,
          standard: PaymentStandard.PAY_TO_ADDRESS,
          asset: { id: asset.id },
          amount,
        },
        payment: { status: PaymentLinkPaymentStatus.PENDING },
      },
      relations: { payment: true },
    });
  }

  async getQuoteByTxId(txBlockchain: Blockchain, txId: string): Promise<PaymentQuote | null> {
    return this.paymentQuoteRepo.findOne({
      where: { txBlockchain: Equal(txBlockchain), txId: Equal(txId) },
      relations: { payment: true },
    });
  }

  async getConfirmingQuotes(): Promise<PaymentQuote[]> {
    return this.paymentQuoteRepo.find({
      where: { status: PaymentQuoteStatus.TX_BLOCKCHAIN },
      relations: { payment: { link: true } },
    });
  }

  async cancelAllForPayment(paymentId: number): Promise<void> {
    const actualQuotes = await this.paymentQuoteRepo.find({
      where: { payment: { id: paymentId }, status: PaymentQuoteStatus.ACTUAL },
    });

    for (const actualQuote of actualQuotes) {
      await this.paymentQuoteRepo.save(actualQuote.cancel());
    }
  }

  async saveTransaction(quote: PaymentQuote, txBlockchain: Blockchain, txId: string): Promise<PaymentQuote> {
    const update = { txBlockchain, txId };

    Object.assign(quote, update);
    await this.paymentQuoteRepo.update(quote.id, update);

    return quote;
  }

  async saveBlockchainConfirmed(quote: PaymentQuote, txBlockchain: Blockchain, txId: string): Promise<PaymentQuote> {
    const status =
      txBlockchain === Blockchain.LIGHTNING ? PaymentQuoteStatus.TX_COMPLETED : PaymentQuoteStatus.TX_BLOCKCHAIN;

    const update = { status, txBlockchain, txId };

    Object.assign(quote, update);
    await this.paymentQuoteRepo.update(quote.id, update);

    return quote;
  }

  async saveFinallyConfirmed(quote: PaymentQuote): Promise<PaymentQuote> {
    const update = { status: PaymentQuoteStatus.TX_COMPLETED };

    Object.assign(quote, update);
    await this.paymentQuoteRepo.update(quote.id, update);

    return quote;
  }

  async getCompletedQuoteCount(payment: PaymentLinkPayment, minCompletionStatus: PaymentQuoteStatus): Promise<number> {
    const allowedStates = PaymentQuoteTxStates.slice(PaymentQuoteTxStates.indexOf(minCompletionStatus));
    return this.paymentQuoteRepo.countBy({ payment: { id: payment.id }, status: In(allowedStates) });
  }

  // --- CREATE --- //
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

    const decimals = Math.min(asset.decimals ?? Infinity, 8);

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

  // --- HEX PAYMENT --- //
  async executeHexPayment(transferInfo: TransferInfo): Promise<PaymentQuote> {
    const quote = await this.getAndCheckQuote(transferInfo);

    quote.txReceived(transferInfo.method, transferInfo.hex);

    try {
      const evmClient = this.evmRegistryService.getClient(transferInfo.method);
      const transactionResponse = await evmClient.sendSignedTransaction(transferInfo.hex);

      transactionResponse.error
        ? quote.txFailed(transactionResponse.error.message)
        : quote.txMempool(transactionResponse.response.hash);
    } catch (e) {
      this.logger.error(`Transaction failed for quote ${transferInfo.quoteUniqueId}:`, e);

      quote.txFailed(e.message ?? 'Transaction failed');
    }

    return this.paymentQuoteRepo.save(quote);
  }

  private async getAndCheckQuote(transferInfo: TransferInfo): Promise<PaymentQuote> {
    const quoteUniqueId = transferInfo.quoteUniqueId;

    if (!quoteUniqueId) throw new BadRequestException('Quote parameter missing');
    if (!transferInfo.method) throw new BadRequestException('Method parameter missing');
    if (!transferInfo.hex) throw new BadRequestException('Hex parameter missing');

    const actualQuote = await this.getActualQuoteByUniqueId(quoteUniqueId);
    if (!actualQuote) throw new NotFoundException(`No actual quote with ID ${quoteUniqueId} found`);

    return actualQuote;
  }
}
