import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull } from 'typeorm';
import { KycWebhookData } from './dto/kyc-webhook.dto';
import { PaymentWebhookData } from './dto/payment-webhook.dto';
import { WebhookDto } from './dto/webhook.dto';
import { Webhook } from './webhook.entity';
import { WebhookRepository } from './webhook.repository';

@Injectable()
export class WebhookNotificationService {
  private readonly logger = new DfxLogger(WebhookNotificationService);

  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly http: HttpService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async checkCryptoPayIn() {
    if (DisabledProcess(Process.WEBHOOK)) return;
    await this.sendOpenWebhooks();
  }

  async sendOpenWebhooks(): Promise<void> {
    const entities = await this.webhookRepo.find({
      where: { sentDate: IsNull() },
      relations: { user: { wallet: true } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'webhooks`);

    for (const entity of entities) {
      try {
        await this.triggerUserWebhook(entity);
        await this.webhookRepo.update(...entity.confirmSentDate());
      } catch (e) {
        this.logger.error(`Failed to send webhook ${entity.id}:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  private async triggerUserWebhook<T extends PaymentWebhookData | KycWebhookData>(webhook: Webhook): Promise<void> {
    try {
      if (!webhook.user.wallet.apiUrl) return;
      if (!webhook.user.wallet.apiKey) throw new Error(`ApiKey for wallet ${webhook.user.wallet.name} not available`);

      const webhookDto: WebhookDto<T> = {
        id: webhook.user.address,
        type: webhook.type,
        data: JSON.parse(webhook.data),
        reason: webhook.reason,
      };

      await this.http.post(webhook.user.wallet.apiUrl, webhookDto, {
        headers: { 'x-api-key': webhook.user.wallet.apiKey },
        retryDelay: 5000,
        tryCount: 3,
      });
    } catch (error) {
      const errMessage = `Exception during ${webhook.type} webhook for user ${webhook.user.id}:`;

      this.logger.error(errMessage, error);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: `${webhook.type} webhook failed`,
          errors: [errMessage, error],
        },
      });
    }
  }
}
