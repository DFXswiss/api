import { Injectable } from '@nestjs/common';
import { CronExpression, Cron } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Lock } from 'src/shared/utils/lock';
import { IsNull, Not } from 'typeorm';
import { LimitRequestDecision } from './limit-request.entity';
import { LimitRequestRepository } from './limit-request.repository';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class LimitRequestNotificationService {
  private readonly logger = new DfxLogger(LimitRequestNotificationService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (Config.processDisabled(Process.LIMIT_REQUEST_MAIL)) return;
    await this.limitRequestAcceptedManual();
  }

  private async limitRequestAcceptedManual(): Promise<void> {
    const entities = await this.limitRequestRepo.find({
      where: {
        mailSendDate: IsNull(),
        decision: LimitRequestDecision.ACCEPTED,
        clerk: Not(IsNull()),
        edited: Not(IsNull()),
      },
      relations: ['userData'],
    });

    entities.length > 0 && this.logger.info(`Sending ${entities.length} 'limit-request accepted' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.PERSONAL,
            input: {
              userData: entity.userData,
              translationKey: 'mail.limitRequest.manualApproved',
              translationParams: {
                firstname: entity.userData.firstname,
                limitAmount:
                  entity.userData.language.symbol === 'DE'
                    ? entity.limit.toLocaleString('de-DE')
                    : entity.limit.toLocaleString('en-US'),
                mailName: Config.support.limitRequest.mailName.split(' ')[0],
              },
              from: Config.support.limitRequest.mailAddress,
              displayName: Config.support.limitRequest.mailName,
              banner: Config.support.limitRequest.mailBanner,
            },
          });
        } else {
          this.logger.warn(`Failed to send limit request accepted mail ${entity.id}: user has no email`);
        }

        await this.limitRequestRepo.update(...entity.sendMail());
      } catch (e) {
        this.logger.error(`Failed to send limit request accepted mail ${entity.id}:`, e);
      }
    }
  }
}
