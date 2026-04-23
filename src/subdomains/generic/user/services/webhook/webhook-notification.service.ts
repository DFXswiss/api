import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, LessThanOrEqual } from 'typeorm';
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

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.WEBHOOK, timeout: 1800 })
  async sendWebhooks() {
    await this.sendOpenWebhooks();
  }

  async sendOpenWebhooks(): Promise<void> {
    const now = new Date();

    const entities = await this.webhookRepo.find({
      where: [{ nextTryDate: LessThanOrEqual(now) }, { nextTryDate: IsNull(), lastTryDate: IsNull() }],
      relations: ['wallet', 'user', 'userData'],
    });

    if (entities.length > 0) this.logger.verbose(`Sending ${entities.length} webhooks`);

    for (const entity of entities) {
      await this.handleSingleWebhook(entity);
    }
  }

  private async handleSingleWebhook(webhook: Webhook): Promise<void> {
    const now = new Date();

    try {
      const result = await this.triggerWebhook(webhook);

      await this.webhookRepo.update(
        { id: webhook.id },
        {
          ...webhook.sentWebhook(result),
          lastTryDate: now,
          nextTryDate: null,
        },
      );
    } catch (error) {
      const nextTryDate = this.getNextTryDateOrNull(webhook);

      if (!nextTryDate) {
        await this.sendManualCheckMail(webhook, error);
      }

      await this.webhookRepo.update(
        { id: webhook.id },
        {
          lastTryDate: now,
          nextTryDate,
        },
      );
    }
  }

  // --- HELPER METHODS --- //

  async triggerWebhook<T extends PaymentWebhookData | KycWebhookData>(webhook: Webhook): Promise<string | undefined> {
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

    return undefined;
  }

  private async sendManualCheckMail(webhook: Webhook, error: any): Promise<void> {
    const id = webhook.id ?? webhook.identifier;
    const errMessage = `Webhook for user data ${webhook.userData.id} and wallet ${webhook.wallet.name} (webhook ${id}) failed for more than 24h.`;

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.WEBHOOK,
      input: {
        subject: `Webhook ${id} requires manual check`,
        errors: [errMessage, error],
      },
    });
  }

  private getNextTryDateOrNull(webhook: Webhook): Date | null {
    const ageMinutes = (new Date().getTime() - webhook.created.getTime()) / 60000;
    if (ageMinutes >= 24 * 60) return null;

    const delayMinutes = ageMinutes < 60 ? 5 : 60;
    return Util.minutesAfter(delayMinutes);
  }
}
