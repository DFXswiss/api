import { Injectable } from '@nestjs/common';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { C2BPaymentOrderRepository } from './repositories/c2b-order.repository';
import { WebhookNotificationsRepository } from './repositories/webhook-notifications.repository';
import { BinancePayService } from './services/binance-pay.service';
import { C2BPaymentStatus } from './share/PaymentStatus';
import { C2BPaymentProvider } from './share/providers.enum';

@Injectable()
export class C2BPaymentLinkService {
  constructor(
    private readonly binancePayService: BinancePayService,
    private readonly c2bPaymentOrderRepository: C2BPaymentOrderRepository,
    private readonly webhookNotificationsRepository: WebhookNotificationsRepository,
  ) {}

  getProvider(provider: C2BPaymentProvider) {
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

    const c2bPaymentOrder = await this.c2bPaymentOrderRepository.create({
      providerOrderId: order.providerOrderId,
      status: C2BPaymentStatus.PENDING,
      provider: transferInfo.method as C2BPaymentProvider,
      quote,
    });

    await this.c2bPaymentOrderRepository.save(c2bPaymentOrder);

    return order;
  }

  async handleWebhook(provider: C2BPaymentProvider, payload: any) {
    const clientProvider = this.getProvider(provider);
    const webhookResult = await clientProvider.handleWebhook(payload);
    if (!webhookResult) return;

    const webhookNotification = await this.webhookNotificationsRepository.create({
      provider,
      payload: JSON.stringify(payload),
    });

    await this.webhookNotificationsRepository.save(webhookNotification);

    const c2bPaymentOrder = await this.c2bPaymentOrderRepository.findOne({
      where: {
        providerOrderId: webhookResult.providerOrderId,
      },
    });

    if (!c2bPaymentOrder) {
      throw new Error('C2B payment order not found');
    }

    c2bPaymentOrder.status = webhookResult.status;
    await this.c2bPaymentOrderRepository.save(c2bPaymentOrder);
  }
}
