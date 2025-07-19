import { Injectable } from '@nestjs/common';
import { KucoinPayService } from 'src/integration/kucoin-pay/kucoin-pay.service';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { BinancePayService } from '../../../../integration/binance-pay/services/binance-pay.service';
import { Blockchain } from '../../../../integration/blockchain/shared/enums/blockchain.enum';
import { C2BPaymentProvider } from '../enums';
import { C2BOrderResult, C2BWebhookResult } from '../share/c2b-payment-link.provider';

@Injectable()
export class C2BPaymentLinkService {
  constructor(
    private readonly binancePayService: BinancePayService,
    private readonly kucoinPayService: KucoinPayService,
  ) {}

  static mapProviderToBlockchain(provider: C2BPaymentProvider): Blockchain {
    switch (provider) {
      case C2BPaymentProvider.BINANCE_PAY:
        return Blockchain.BINANCE_PAY;

      case C2BPaymentProvider.KUCOIN_PAY:
        return Blockchain.KUCOIN_PAY;

      default:
        throw new Error(`Provider ${provider} not supported`);
    }
  }

  static mapBlockchainToProvider(blockchain: Blockchain): C2BPaymentProvider {
    switch (blockchain) {
      case Blockchain.BINANCE_PAY:
        return C2BPaymentProvider.BINANCE_PAY;

      case Blockchain.KUCOIN_PAY:
        return C2BPaymentProvider.KUCOIN_PAY;

      default:
        throw new Error(`Blockchain ${blockchain} not supported`);
    }
  }

  static isC2BProvider(blockchain: Blockchain): boolean {
    try {
      C2BPaymentLinkService.mapBlockchainToProvider(blockchain);
      return true;
    } catch (error) {
      return false;
    }
  }

  getProvider(provider: C2BPaymentProvider) {
    switch (provider) {
      case C2BPaymentProvider.BINANCE_PAY:
        return this.binancePayService;

      case C2BPaymentProvider.KUCOIN_PAY:
        return this.kucoinPayService;

      default:
        throw new Error(`Provider ${provider} not supported`);
    }
  }

  async createOrder(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<C2BOrderResult> {
    const clientProvider = this.getProvider(transferInfo.method as C2BPaymentProvider);
    return clientProvider.createOrder(payment, transferInfo, quote);
  }

  async handleWebhook(provider: C2BPaymentProvider, payload: any): Promise<C2BWebhookResult | undefined> {
    const clientProvider = this.getProvider(provider);
    return clientProvider.handleWebhook(payload);
  }

  isPaymentLinkEnrolled(blockchain: Blockchain, paymentLink: PaymentLink): boolean {
    const clientProvider = this.getProvider(C2BPaymentLinkService.mapBlockchainToProvider(blockchain));
    return clientProvider.isPaymentLinkEnrolled(paymentLink);
  }

  enrollPaymentLink(paymentLink: PaymentLink, provider: C2BPaymentProvider): Promise<Record<string, string>> {
    const clientProvider = this.getProvider(provider);
    return clientProvider.enrollPaymentLink(paymentLink);
  }
}
