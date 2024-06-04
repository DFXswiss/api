import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { IsNull } from 'typeorm';
import { WebhookRepository } from './webhook.repository';

@Injectable()
export class WebhookJobService {
  private readonly logger = new DfxLogger(WebhookJobService);

  constructor(private readonly webhookRepo: WebhookRepository) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async sendWebhooks() {
    if (DisabledProcess(Process.SYNCHRONIZE_WEBHOOK)) return;
    await this.setWebhookRelations();
  }

  async setWebhookRelations(): Promise<void> {
    const entities = await this.webhookRepo.find({
      where: { userData: IsNull() },
      relations: { user: { userData: true, wallet: true } },
    });

    for (const entity of entities) {
      try {
        await this.webhookRepo.update(entity.id, { userData: entity.user.userData, wallet: entity.user.wallet });
      } catch (e) {
        this.logger.error(`Failed to set webhook relations ${entity.id}:`, e);
      }
    }
  }
}
