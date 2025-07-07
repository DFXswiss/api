import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentCronService {
  constructor(private readonly paymentLinkPaymentService: PaymentLinkPaymentService) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }
}
