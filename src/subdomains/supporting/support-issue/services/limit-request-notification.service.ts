import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull, Not } from 'typeorm';
import { LimitRequestDecision } from '../entities/limit-request.entity';
import { LimitRequestRepository } from '../repositories/limit-request.repository';

@Injectable()
export class LimitRequestNotificationService {
  private readonly logger = new DfxLogger(LimitRequestNotificationService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.LIMIT_REQUEST_MAIL, timeout: 1800 })
  async sendNotificationMails(): Promise<void> {
    await this.limitRequestAcceptedManual();
  }

  private async limitRequestAcceptedManual(): Promise<void> {
    const entities = await this.limitRequestRepo.findBy({
      mailSendDate: IsNull(),
      decision: In([LimitRequestDecision.ACCEPTED, LimitRequestDecision.PARTIALLY_ACCEPTED]),
      clerk: Not(IsNull()),
      edited: Not(IsNull()),
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'limit-request accepted' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.PERSONAL,
            context: MailContext.LIMIT_REQUEST,
            input: {
              userData: entity.userData,
              title: `${MailTranslationKey.LIMIT_REQUEST}.title`,
              prefix: [
                {
                  key: `${MailTranslationKey.GENERAL}.welcome`,
                  params: { name: entity.userData.firstname },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                {
                  key: `${MailTranslationKey.LIMIT_REQUEST}.message`,
                  params: {
                    limitAmount:
                      entity.userData.language.symbol === 'DE'
                        ? entity.userData.depositLimit.toLocaleString('de-DE')
                        : entity.userData.depositLimit.toLocaleString('en-US'),
                  },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.GENERAL}.thanks` },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.GENERAL}.team_questions` },
                { key: MailKey.SPACE, params: { value: '2' } },
                {
                  key: `${MailTranslationKey.GENERAL}.dfx_team_closing`,
                },
              ],
              from: Config.support.limitRequest.mailAddress,
              bcc: Config.support.limitRequest.mailAddressSupportStaff,
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
