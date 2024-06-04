import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
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
  async sendWebhooks() {
    if (DisabledProcess(Process.WEBHOOK)) return;
    await this.sendOpenWebhooks();
  }

  async sendOpenWebhooks(): Promise<void> {
    const entities = await this.webhookRepo.find({ where: { lastTryDate: IsNull() } });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'webhooks`);

    for (const entity of entities) {
      try {
        const result = await this.triggerWebhook(entity);
        await this.webhookRepo.update(...entity.sentWebhook(result));
      } catch (e) {
        this.logger.error(`Failed to send webhook ${entity.id}:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  async triggerWebhook<T extends PaymentWebhookData | KycWebhookData>(webhook: Webhook): Promise<string | undefined> {
    try {
      if (!webhook.wallet.apiUrl)
        throw new Error(`API URL for wallet ${webhook.wallet.name} not available anymore in webhook ${webhook.id}`);

      const webhookDto: WebhookDto<T> = {
        accountId: webhook.userData.id,
        id: webhook.user?.address,
        type: webhook.type,
        data: JSON.parse(webhook.data),
        reason: webhook.reason,
      };

      await this.http.post(webhook.wallet.apiUrl, webhookDto, {
        headers: { 'x-api-key': webhook.wallet.apiKey },
        retryDelay: 5000,
        tryCount: 3,
      });
    } catch (error) {
      const errMessage = `Exception during webhook for user data ${webhook.userData.id} and wallet ${webhook.wallet.name} (webhook ${webhook.id}):`;

      this.logger.error(errMessage, error);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.WEBHOOK,
        input: {
          subject: `Webhook ${webhook.id} failed`,
          errors: [errMessage, error],
        },
      });

      return error;
    }
  }
}
