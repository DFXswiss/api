import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { PaymentLinkPaymentStatus } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../entities/payment-activation.entity';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';

@Injectable()
export class PaymentCronService {
  constructor(
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly paymentActivationRepo: PaymentActivationRepository,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  @Lock()
  async processPendingPayments(): Promise<void> {
    if (DisabledProcess(Process.UPDATE_PAYMENT)) return;

    await this.doProcessPendingPayments();
    await this.doProcessPendingActivations();
  }

  private async doProcessPendingPayments() {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentLinkPayments = await this.paymentLinkPaymentRepo.findBy({
      status: PaymentLinkPaymentStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentLinkPayment of pendingPaymentLinkPayments) {
      await this.paymentLinkPaymentRepo.save(pendingPaymentLinkPayment.expire());
    }
  }

  private async doProcessPendingActivations(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentActivations = await this.paymentActivationRepo.findBy({
      status: PaymentActivationStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentActivation of pendingPaymentActivations) {
      await this.paymentActivationRepo.save(pendingPaymentActivation.expire());
    }
  }
}
