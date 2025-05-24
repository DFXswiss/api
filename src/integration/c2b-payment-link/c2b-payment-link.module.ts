import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { C2BPaymentLinkService } from './c2b-payment-link.service';
import { C2BPaymentOrder } from './entities/c2b-order.entity';
import { WebhookNotifications } from './entities/webhook-notifications.entity';
import { C2BPaymentOrderRepository } from './repositories/c2b-order.repository';
import { WebhookNotificationsRepository } from './repositories/webhook-notifications.repository';
import { BinancePayService } from './services/binance-pay.service';

@Module({
  imports: [TypeOrmModule.forFeature([C2BPaymentOrder, WebhookNotifications]), SharedModule],
  providers: [BinancePayService, C2BPaymentLinkService, C2BPaymentOrderRepository, WebhookNotificationsRepository],
  exports: [BinancePayService, C2BPaymentLinkService],
})
export class C2BPaymentLinkModule {}
