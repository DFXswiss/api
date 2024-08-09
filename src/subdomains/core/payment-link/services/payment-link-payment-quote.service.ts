import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LessThan } from 'typeorm';
import { TransferAmount, TransferAmountAsset } from '../dto/payment-link.dto';
import { PaymentLinkPaymentQuote } from '../entities/payment-link-payment-quote.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLinkPaymentQuoteStatus } from '../enums';
import { PaymentLinkPaymentQuoteRepository } from '../repositories/payment-link-payment-quote.repository';

@Injectable()
export class PaymentLinkPaymentQuoteService {
  private readonly logger = new DfxLogger(PaymentLinkPaymentQuoteService);

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
    private paymentLinkPaymentQuoteRepo: PaymentLinkPaymentQuoteRepository,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
  ) {}

  async processActualQuotes(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const actualPaymentLinkQuotes = await this.paymentLinkPaymentQuoteRepo.findBy({
      status: PaymentLinkPaymentQuoteStatus.ACTUAL,
      expiryDate: LessThan(maxDate),
    });

    for (const actualPaymentLinkQuote of actualPaymentLinkQuotes) {
      await this.paymentLinkPaymentQuoteRepo.save(actualPaymentLinkQuote.expire());
    }
  }

  async getActualQuote(uniqueId: string): Promise<PaymentLinkPaymentQuote | null> {
    return this.paymentLinkPaymentQuoteRepo.findOne({
      where: {
        uniqueId: uniqueId,
        status: PaymentLinkPaymentQuoteStatus.ACTUAL,
      },
    });
  }

  async getActualQuotes(paymentId: number): Promise<PaymentLinkPaymentQuote[]> {
    return this.paymentLinkPaymentQuoteRepo.find({
      where: {
        payment: { id: paymentId },
        status: PaymentLinkPaymentQuoteStatus.ACTUAL,
      },
    });
  }

  async createQuote(payment: PaymentLinkPayment): Promise<PaymentLinkPaymentQuote> {
    const quote = this.paymentLinkPaymentQuoteRepo.create({
      uniqueId: Util.createUniqueId(PaymentLinkPaymentQuoteService.PREFIX_UNIQUE_ID),
      status: PaymentLinkPaymentQuoteStatus.ACTUAL,
      transferAmounts: await this.createTransferAmounts(payment).then(JSON.stringify),
      expiryDate: Util.secondsAfter(Config.payment.quoteTimeout),
      payment: payment,
    });

    return this.paymentLinkPaymentQuoteRepo.save(quote);
  }

  private async createTransferAmounts(payment: PaymentLinkPayment): Promise<TransferAmount[]> {
    const transferAmounts: TransferAmount[] = [];

    const paymentAssetMap = await this.createOrderedPaymentAssetMap();

    for (const paymentAssetMapEntry of paymentAssetMap.entries()) {
      const blockchain = paymentAssetMapEntry[0];
      const assets = paymentAssetMapEntry[1];

      const transferAmount: TransferAmount = {
        method: blockchain,
        assets: [],
      };

      for (const asset of assets) {
        const transferAmountAsset = await this.getTransferAmountAsset(payment.currency, asset, payment.amount);
        if (transferAmountAsset) transferAmount.assets.push(transferAmountAsset);
      }

      if (blockchain === Blockchain.LIGHTNING) this.addMsatAsset(transferAmount);

      if (transferAmount.assets.length) transferAmounts.push(transferAmount);
    }

    return transferAmounts;
  }

  private addMsatAsset(transferAmount: TransferAmount) {
    const btcAsset = transferAmount.assets.find((a) => a.asset === 'BTC');

    if (btcAsset) {
      transferAmount.assets.unshift({
        asset: 'MSAT',
        amount: LightningHelper.btcToMsat(btcAsset.amount),
      });
    }
  }

  private async createOrderedPaymentAssetMap(): Promise<Map<Blockchain, Asset[]>> {
    const paymentAssets = await this.assetService.getPaymentAssets();

    const paymentAssetMap = new Map<Blockchain, Asset[]>();

    for (const blockchain of this.transferAmountOrder) {
      paymentAssetMap.set(
        blockchain,
        paymentAssets.filter((a) => a.blockchain === blockchain),
      );
    }

    return paymentAssetMap;
  }

  private async getTransferAmountAsset(
    currency: Fiat,
    asset: Asset,
    amount: number,
  ): Promise<TransferAmountAsset | undefined> {
    const transferAmount = await this.getTransferAmount(currency, asset, amount);
    if (!transferAmount) return;

    return {
      asset: asset.name,
      amount: transferAmount,
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
    const actualQuotes = await this.paymentLinkPaymentQuoteRepo.find({
      where: { payment: { id: paymentId }, status: PaymentLinkPaymentQuoteStatus.ACTUAL },
    });

    for (const actualQuote of actualQuotes) {
      await this.paymentLinkPaymentQuoteRepo.save(actualQuote.cancel());
    }
  }
}
