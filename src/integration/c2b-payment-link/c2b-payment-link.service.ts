import { Injectable } from '@nestjs/common';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';
import { BinancePayService } from './services/binance-pay.service';
import { C2BPaymentProvider } from './share/providers.enum';

@Injectable()
export class C2BPaymentLinkService {
  constructor(private readonly binancePayService: BinancePayService) {}

  getProvider(provider: C2BPaymentProvider | Blockchain) {
    switch (provider) {
      case C2BPaymentProvider.BINANCE_PAY:
        return this.binancePayService;
      default:
        throw new Error(`Provider ${provider} not supported`);
    }
  }

  async createOrder(payment: PaymentLinkPayment, transferInfo: TransferInfo, quote: PaymentQuote) {
    const clientProvider = this.getProvider(transferInfo.method as C2BPaymentProvider);
    const order = await clientProvider.createOrder(payment, transferInfo, quote);

    return order;
  }

  async handleWebhook(provider: C2BPaymentProvider | Blockchain, payload: any) {
    const clientProvider = this.getProvider(provider);
    const webhookResult = await clientProvider.handleWebhook(payload);
    if (!webhookResult) return;

    return webhookResult;
  }
}
