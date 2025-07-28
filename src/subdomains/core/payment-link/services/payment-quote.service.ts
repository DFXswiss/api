import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { C2BPaymentLinkService } from 'src/subdomains/core/payment-link/services/c2b-payment-link.service';
import { PaymentLinkFeeService } from 'src/subdomains/core/payment-link/services/payment-link-fee.service';
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
  private readonly transferAmountBlockchainOrder: Blockchain[] = [
    Blockchain.LIGHTNING,
    Blockchain.POLYGON,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.BASE,
    Blockchain.GNOSIS,
    Blockchain.ETHEREUM,
    Blockchain.MONERO,
    Blockchain.BITCOIN,
    Blockchain.SOLANA,
  ];

  private readonly transferAmountAssetOrder: string[] = ['dEURO', 'ZCHF', 'USDT', 'USDC', 'DAI'];

  constructor(
    private readonly paymentQuoteRepo: PaymentQuoteRepository,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
    private readonly feeService: PaymentLinkFeeService,
    private readonly c2bPaymentLinkService: C2BPaymentLinkService,
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
  async getActualQuote(payment: PaymentLinkPayment, transferInfo: TransferInfo): Promise<PaymentQuote | undefined> {
    return transferInfo.quoteUniqueId
      ? this.getActualQuoteByUniqueId(transferInfo.quoteUniqueId) ?? undefined
      : this.getActualQuoteByPaymentId(payment, transferInfo); // fallback for Lightning
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
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
  ): Promise<PaymentQuote | undefined> {
    const standard = payment.link.getMatchingStandard();

    const actualQuotes = await this.paymentQuoteRepo.find({
      where: {
        payment: { id: Equal(payment.id) },
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

  async getQuoteByTxId(
    txBlockchain: Blockchain,
    txId: string,
    status: PaymentQuoteStatus[],
  ): Promise<PaymentQuote | null> {
    return this.paymentQuoteRepo.findOne({
      where: { txBlockchain: Equal(txBlockchain), txId: Equal(txId), status: In(status) },
      relations: { payment: true },
    });
  }

  async getConfirmingQuotes(): Promise<PaymentQuote[]> {
    return this.paymentQuoteRepo.find({
      where: { status: PaymentQuoteStatus.TX_BLOCKCHAIN },
      relations: { payment: { link: { route: { user: { userData: true } } } } },
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
    const status = [Blockchain.LIGHTNING, Blockchain.BINANCE_PAY, Blockchain.KUCOIN_PAY].includes(txBlockchain)
      ? PaymentQuoteStatus.TX_COMPLETED
      : PaymentQuoteStatus.TX_BLOCKCHAIN;

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
    const timeoutSeconds = Config.payment.quoteTimeout(standard);

    const expiryDate = new Date(Math.min(payment.expiryDate.getTime(), Util.secondsAfter(timeoutSeconds).getTime()));

    const quote = this.paymentQuoteRepo.create({
      uniqueId: Util.createUniqueId(Config.prefixes.paymentQuoteUidPrefix, 16),
      status: PaymentQuoteStatus.ACTUAL,
      transferAmounts: await this.createTransferAmounts(standard, payment).then(JSON.stringify),
      expiryDate,
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

    for (const method of Config.payment.manualMethods) {
      if (method === 'Liquid' || method === 'Ark') {
        transferAmounts.push({
          method,
          minFee: 0,
          assets: [{ asset: 'BTC', amount: 0 }],
          available: true,
        });
      } else {
        transferAmounts.push({
          method,
          minFee: 0,
          assets: [],
          available: false,
        });
      }
    }

    return transferAmounts;
  }

  private async createTransferAmount(
    standard: PaymentStandard,
    payment: PaymentLinkPayment,
    blockchain: Blockchain,
    assets: Asset[],
  ): Promise<TransferAmount> {
    const minFee = await this.feeService.getMinFee(blockchain);

    const transferAmount: TransferAmount = {
      method: blockchain,
      minFee: minFee,
      assets: [],
      available: true,
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

    if (C2BPaymentLinkService.isC2BProvider(blockchain)) {
      if (!this.c2bPaymentLinkService.isPaymentLinkEnrolled(blockchain, payment.link)) {
        transferAmount.available = false;
        transferAmount.assets = [];
      }
    }

    return transferAmount;
  }

  private async createOrderedPaymentAssetMap(blockchains: Blockchain[]): Promise<Map<Blockchain, Asset[]>> {
    const paymentAssets = await this.assetService.getPaymentAssets();

    const availableAssets = paymentAssets
      .filter((a) => blockchains.includes(a.blockchain))
      .sort((a, b) => {
        const sortOrderA = this.getBlockchainSortOrder(a.blockchain);
        const sortOrderB = this.getBlockchainSortOrder(b.blockchain);

        if (sortOrderA === sortOrderB) return this.getAssetSortOrder(a) - this.getAssetSortOrder(b);

        return sortOrderA - sortOrderB;
      });

    return Util.groupBy<Asset, Blockchain>(availableAssets, 'blockchain');
  }

  private getBlockchainSortOrder(blockchain: Blockchain): number {
    const index = this.transferAmountBlockchainOrder.indexOf(blockchain);
    return index < 0 ? Infinity : index;
  }

  private getAssetSortOrder(asset: Asset): number {
    const index = this.transferAmountAssetOrder.indexOf(asset.name);
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
    try {
      const price = await this.pricingService.getPrice(asset, currency, true);
      const fee = Config.payment.fee(standard, currency, asset);

      return price.invert().convert(amount / (1 - fee), 8);
    } catch (e) {
      this.logger.error(`Quote: Failed to get price of currency ${currency.name} and asset ${asset.uniqueName}`, e);
    }
  }

  // --- HEX PAYMENT --- //
  async executeHexPayment(transferInfo: TransferInfo): Promise<PaymentQuote> {
    const quote = await this.getAndCheckQuote(transferInfo);

    if (transferInfo.hex) {
      // Used for checking purposes
      const verifiedSignMessage = Util.verifySign(
        Config.payment.checkbotSignTx,
        Config.payment.checkbotPubKey,
        transferInfo.hex,
        'sha256',
        'hex',
      );

      if (verifiedSignMessage) {
        quote.txFromCheckbot(Config.payment.checkbotSignTx);
        return this.paymentQuoteRepo.save(quote);
      }
    }

    quote.txReceived(transferInfo.method as Blockchain, transferInfo.hex, transferInfo.tx);
    await this.paymentQuoteRepo.save(quote);

    try {
      switch (transferInfo.method) {
        case Blockchain.ETHEREUM:
        case Blockchain.ARBITRUM:
        case Blockchain.OPTIMISM:
        case Blockchain.BASE:
        case Blockchain.GNOSIS:
        case Blockchain.POLYGON:
          await this.doEvmHexPayment(transferInfo.method, transferInfo, quote);
          break;

        case Blockchain.BITCOIN:
          await this.doBitcoinHexPayment(transferInfo.method, transferInfo, quote);
          break;

        case Blockchain.MONERO:
        case Blockchain.SOLANA:
          await this.doTxIdPayment(transferInfo, quote);
          break;

        default:
          throw new BadRequestException(`Invalid method ${transferInfo.method} for hex payment`);
      }
    } catch (e) {
      this.logger.error(`Transaction failed for quote ${transferInfo.quoteUniqueId}:`, e);

      quote.txFailed(e.message ?? 'Transaction failed');
    }

    return this.paymentQuoteRepo.save(quote);
  }

  private async doEvmHexPayment(method: Blockchain, transferInfo: TransferInfo, quote: PaymentQuote): Promise<void> {
    try {
      const client = this.blockchainRegistryService.getEvmClient(method);

      // handle TX ID
      if (transferInfo.tx && !transferInfo.hex) {
        const tryCount = Config.payment.defaultEvmHexPaymentTryCount;

        for (let i = 0; i < tryCount; i++) {
          const isComplete = await client.isTxComplete(transferInfo.tx, 1);
          if (isComplete) {
            quote.txInBlockchain(transferInfo.tx);
            return;
          }

          await Util.delay(1000);
        }

        throw new BadRequestException(`Transaction ${transferInfo.tx} not found in blockchain ${transferInfo.method}`);
      }

      // handle HEX
      const transferAmount = quote.getTransferAmount(method);
      if (!transferAmount) {
        quote.txFailed(`Quote ${quote.uniqueId}: No transfer amount for ${method} hex payment`);
        return;
      }

      const feeLimit = await client.getGasPriceLimitFromHex(transferInfo.hex);

      if (feeLimit < transferAmount.minFee) {
        quote.txFailed(`Fee ${feeLimit} lower than min fee ${transferAmount.minFee}`);
        return;
      }

      const transactionResponse = await client.sendSignedTransaction(transferInfo.hex);

      transactionResponse.error
        ? quote.txFailed(transactionResponse.error.message)
        : quote.txInMempool(transactionResponse.response.hash);
    } catch (e) {
      quote.txFailed(e.message);
    }
  }

  private async doBitcoinHexPayment(
    method: Blockchain,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<void> {
    try {
      const transferAmount = quote.getTransferAmount(Blockchain.BITCOIN);
      if (!transferAmount) {
        quote.txFailed(`Quote ${quote.uniqueId}: No transfer amount for Bitcoin hex payment`);
        return;
      }

      const client = this.blockchainRegistryService.getBitcoinClient(method, BitcoinNodeType.BTC_OUTPUT);

      const testMempoolResults = await client.testMempoolAccept(transferInfo.hex);

      if (testMempoolResults?.length !== 1) {
        quote.txFailed('Wrong number of mempool results received');
        return;
      }

      const testMempoolResult = testMempoolResults[0];

      if (!testMempoolResult.allowed) {
        quote.txFailed(testMempoolResult['reject-reason']);
        return;
      }

      const baseFee = LightningHelper.btcToSat(testMempoolResult.fees.base);
      const satPerVB = baseFee / testMempoolResult.vsize;

      if (satPerVB < transferAmount.minFee) {
        quote.txFailed(`Fee ${satPerVB} lower than min fee ${transferAmount.minFee}`);
        return;
      }

      const transactionResponse = await client.sendSignedTransaction(transferInfo.hex);

      transactionResponse.error
        ? quote.txFailed(transactionResponse.error.message)
        : quote.txInMempool(transactionResponse.hash);
    } catch (e) {
      quote.txFailed(e.message);
    }
  }

  private async doTxIdPayment(transferInfo: TransferInfo, quote: PaymentQuote): Promise<void> {
    try {
      transferInfo.tx ? quote.txInMempool(transferInfo.tx) : quote.txFailed('Transaction Id not found');
    } catch (e) {
      quote.txFailed(e.message);
    }
  }

  private async getAndCheckQuote(transferInfo: TransferInfo): Promise<PaymentQuote> {
    const quoteUniqueId = transferInfo.quoteUniqueId;

    if (!quoteUniqueId) throw new BadRequestException('Quote parameter missing');
    if (!transferInfo.method) throw new BadRequestException('Method parameter missing');
    if (!transferInfo.hex && !transferInfo.tx) throw new BadRequestException('Hex or Tx parameter missing');

    const actualQuote = await this.getActualQuoteByUniqueId(quoteUniqueId);
    if (!actualQuote) throw new NotFoundException(`No actual quote with ID ${quoteUniqueId} found`);

    return actualQuote;
  }
}
