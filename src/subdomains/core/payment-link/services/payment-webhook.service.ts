import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new DfxLogger(PaymentWebhookService);

  private readonly webhookSendQueue: QueueHandler;

  constructor(
    private readonly http: HttpService,
    private readonly paymentLinkRepo: PaymentLinkRepository,
  ) {
    this.webhookSendQueue = QueueHandler.createParallelQueueHandler(10);
  }

  async sendWebhook(paymentLink: PaymentLink): Promise<void> {
    this.webhookSendQueue
      .handle<void>(async () => this.doSendWebhook(paymentLink))
      .catch((e) => {
        this.logger.error(`Exception during webhook for payment link ${paymentLink.uniqueId}:`, e);
      });
  }

  private async doSendWebhook(paymentLink: PaymentLink) {
    if (!paymentLink.webhookUrl) return;

    if (this.isInCooldown(paymentLink)) {
      this.logger.info(
        `Skipping webhook for payment link ${paymentLink.uniqueId}: ${paymentLink.webhookFailCount} consecutive failures, cooldown active`,
      );
      return;
    }

    const dto = PaymentLinkDtoMapper.toLinkDto(paymentLink);
    const payload = JSON.stringify(dto);
    const signature = this.createSignature(payload);

    try {
      await this.http.post(dto.webhookUrl, dto, {
        retryDelay: 5000,
        tryCount: 12,
        headers: {
          'X-Payload-Signature': signature,
          'Content-Type': 'application/json',
        },
      });

      await this.onSendSuccess(paymentLink);
    } catch (e) {
      await this.onSendFailure(paymentLink);
      throw e;
    }
  }

  private isInCooldown(paymentLink: PaymentLink): boolean {
    if (paymentLink.webhookFailCount < Config.payment.webhookFailureThreshold) return false;

    return Util.secondsDiff(paymentLink.webhookLastFailedAt, new Date()) < Config.payment.webhookFailureCooldown;
  }

  private async onSendSuccess(paymentLink: PaymentLink): Promise<void> {
    if (!paymentLink.webhookFailCount) return;

    paymentLink.webhookFailCount = 0;
    paymentLink.webhookLastFailedAt = null;
    await this.paymentLinkRepo.update(paymentLink.id, { webhookFailCount: 0, webhookLastFailedAt: null });
  }

  private async onSendFailure(paymentLink: PaymentLink): Promise<void> {
    paymentLink.webhookFailCount += 1;
    paymentLink.webhookLastFailedAt = new Date();
    await this.paymentLinkRepo.update(paymentLink.id, {
      webhookFailCount: paymentLink.webhookFailCount,
      webhookLastFailedAt: paymentLink.webhookLastFailedAt,
    });
  }

  private createSignature(payload: string): string {
    const privateKey = Config.payment.webhookPrivateKey;
    if (!privateKey) {
      throw new Error('Webhook private key is not configured');
    }

    const payloadHash = Util.createHash(payload);
    return Util.createSign(payloadHash, privateKey);
  }
}
