import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, LessThan, MoreThanOrEqual } from 'typeorm';
import { KycLevel, UserData } from '../../user/models/user-data/user-data.entity';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepStatus } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class KycNotificationService {
  private readonly logger = new DfxLogger(KycNotificationService);

  constructor(
    private readonly kycStepRepo: KycStepRepository,
    private readonly notificationService: NotificationService,
    private readonly webhookService: WebhookService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (DisabledProcess(Process.KYC_MAIL)) return;
    await this.kycReminder();
  }

  private async kycReminder(): Promise<void> {
    const entities = await this.kycStepRepo.find({
      where: {
        reminderSentDate: IsNull(),
        status: KycStepStatus.IN_PROGRESS,
        updated: LessThan(Util.daysBefore(Config.kyc.reminderAfterDays)),
        userData: { kycLevel: MoreThanOrEqual(0) },
      },
      relations: ['userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} KYC reminder email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.userData.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.KYC_REMINDER,
            input: {
              userData: entity.userData,
              title: `${MailTranslationKey.KYC_REMINDER}.title`,
              salutation: { key: `${MailTranslationKey.KYC_REMINDER}.salutation` },
              suffix: [
                { key: MailKey.SPACE, params: { value: '1' } },
                { key: `${MailTranslationKey.KYC_REMINDER}.message` },
                { key: MailKey.SPACE, params: { value: '2' } },
                {
                  key: `${MailTranslationKey.KYC}.next_step`,
                  params: {
                    url: entity.userData.kycUrl,
                    urlText: entity.userData.kycUrl,
                  },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.button`,
                  params: {
                    url: entity.userData.kycUrl,
                  },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.KYC}.last_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        } else {
          this.logger.warn(`Failed to send KYC reminder mail for user data ${entity.userData.id}: user has no email`);
        }

        await this.kycStepRepo.update(...entity.reminderSent());
      } catch (e) {
        this.logger.error(`Failed to send KYC reminder mail for KYC step ${entity.id}:`, e);
      }
    }
  }

  async identFailed(entity: KycStep, reason: string): Promise<void> {
    try {
      if ((entity.userData.mail, !DisabledProcess(Process.KYC_MAIL))) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: MailContext.KYC_FAILED,
          input: {
            userData: entity.userData,
            title: `${MailTranslationKey.KYC_FAILED}.title`,
            salutation: { key: `${MailTranslationKey.KYC_FAILED}.salutation` },
            suffix: [
              { key: MailKey.SPACE, params: { value: '1' } },
              {
                key: `${MailTranslationKey.KYC_FAILED}.message`,
                params: {
                  url: entity.userData.kycUrl,
                  urlText: entity.userData.kycUrl,
                },
              },
              {
                key: `${MailTranslationKey.GENERAL}.button`,
                params: {
                  url: entity.userData.kycUrl,
                },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              { key: `${MailTranslationKey.KYC}.last_step` },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        !entity.userData.mail &&
          this.logger.warn(`Failed to send ident failed mail for user data ${entity.userData.id}: user has no email`);
      }

      // KYC webhook external services
      await this.webhookService.kycFailed(entity.userData, reason);
    } catch (e) {
      this.logger.error(`Failed to send ident failed mail or webhook ${entity.id}:`, e);
    }
  }

  async kycChanged(userData: UserData, newLevel?: KycLevel): Promise<void> {
    try {
      if (userData.mail && newLevel === KycLevel.LEVEL_50 && !DisabledProcess(Process.KYC_MAIL)) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: MailContext.KYC_CHANGED,
          input: {
            userData,
            title: `${MailTranslationKey.KYC_SUCCESS}.title`,
            salutation: { key: `${MailTranslationKey.KYC_SUCCESS}.salutation` },
            suffix: [
              { key: MailKey.SPACE, params: { value: '1' } },
              { key: `${MailTranslationKey.KYC_SUCCESS}.message` },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: `${MailTranslationKey.GENERAL}.happy_trading` },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        !userData.mail &&
          this.logger.warn(`Failed to send KYC completion mail for user data ${userData.id}: user has no email`);
      }

      // KYC webhook external services
      await this.webhookService.kycChanged(userData);
    } catch (e) {
      this.logger.error(`Failed to send KYC success mail or KYC changed webhook ${userData.id}:`, e);
    }
  }
}
