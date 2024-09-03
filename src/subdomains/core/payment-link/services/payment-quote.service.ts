import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmGasPriceService } from 'src/integration/blockchain/shared/evm/evm-gas-price.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LessThan } from 'typeorm';
import { TransferAmount, TransferAmountAsset, TransferInfo } from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
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

  constructor(
    private paymentQuoteRepo: PaymentQuoteRepository,
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

  async getActualQuote(paymentId: number, transferInfo: TransferInfo): Promise<PaymentQuote | undefined> {
    return transferInfo.quoteUniqueId
      ? this.getActualQuoteByUniqueId(transferInfo.quoteUniqueId) ?? undefined
      : this.getActualQuoteByPaymentId(paymentId, transferInfo);
  }

  private async getActualQuoteByUniqueId(uniqueId: string): Promise<PaymentQuote | null> {
    return this.paymentQuoteRepo.findOne({
      where: {
        uniqueId: uniqueId,
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
        payment: { id: paymentId },
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

  async createQuote(payment: PaymentLinkPayment, standard: PaymentStandard): Promise<PaymentQuote> {
    const quote = this.paymentQuoteRepo.create({
      uniqueId: Util.createUniqueId(PaymentQuoteService.PREFIX_UNIQUE_ID),
      status: PaymentQuoteStatus.ACTUAL,
      transferAmounts: await this.createTransferAmounts(payment).then(JSON.stringify),
      expiryDate: Util.secondsAfter(Config.payment.quoteTimeout),
      standard,
      payment,
    });

    return this.paymentQuoteRepo.save(quote);
  }

  private async createTransferAmounts(payment: PaymentLinkPayment): Promise<TransferAmount[]> {
    const transferAmounts: TransferAmount[] = [];

    const paymentAssetMap = await this.createOrderedPaymentAssetMap(payment.link.configObj.blockchains);

    for (const [blockchain, assets] of paymentAssetMap.entries()) {
      const transferAmount = await this.createTransferAmount(blockchain, assets, payment);

      if (transferAmount.assets.length) transferAmounts.push(transferAmount);
    }

    return transferAmounts;
  }

  private async createTransferAmount(
    blockchain: Blockchain,
    assets: Asset[],
    payment: PaymentLinkPayment,
  ): Promise<TransferAmount> {
    const minFee = await this.getMinFee(blockchain);

    const transferAmount: TransferAmount = {
      method: blockchain,
      minFee: minFee,
      assets: [],
    };

    if (minFee != null) {
      for (const asset of assets) {
        const transferAmountAsset = await this.getTransferAmountAsset(payment.currency, asset, payment.amount);
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
    currency: Fiat,
    asset: Asset,
    amount: number,
  ): Promise<TransferAmountAsset | undefined> {
    const transferAmount = await this.getTransferAmount(currency, asset, amount);
    if (!transferAmount) return;

    const decimals = asset.decimals ?? 18;

    return {
      asset: asset.name,
      amount: Util.round(transferAmount, decimals),
    };
  }

  private async getTransferAmount(currency: Fiat, asset: Asset, amount: number): Promise<number | undefined> {
    if (currency.name === 'CHF' && asset.name === 'ZCHF') return amount;

    try {
      const price = await this.pricingService.getPrice(asset, currency, true);
      return price.invert().convert(amount / (1 - Config.payment.fee), 8);
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
}
