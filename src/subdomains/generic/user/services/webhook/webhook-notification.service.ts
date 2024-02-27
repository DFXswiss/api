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
  async sendWebhooks() {
    if (DisabledProcess(Process.WEBHOOK)) return;
    await this.sendOpenWebhooks();
  }

  async sendOpenWebhooks(): Promise<void> {
    const entities = await this.webhookRepo.find({
      where: { lastTryDate: IsNull() },
      relations: { user: { wallet: true } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'webhooks`);

    for (const entity of entities) {
      try {
        const result = await this.triggerUserWebhook(entity);
        await this.webhookRepo.update(...entity.sentWebhook(result));
      } catch (e) {
        this.logger.error(`Failed to send webhook ${entity.id}:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  private async triggerUserWebhook<T extends PaymentWebhookData | KycWebhookData>(webhook: Webhook): Promise<boolean> {
    try {
      if (!webhook.user.wallet.apiUrl)
        throw new Error(`ApiUrl for wallet ${webhook.user.wallet.name} not available anymore in webhook ${webhook.id}`);

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

      return true;
    } catch (error) {
      const errMessage = `Exception during webhook ${webhook.id}:`;

      this.logger.error(errMessage, error);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: `Webhook ${webhook.id} failed`,
          errors: [errMessage, error],
        },
      });

      return false;
    }
  }
}
