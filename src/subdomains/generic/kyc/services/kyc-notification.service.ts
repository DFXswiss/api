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
import { In, IsNull, LessThan, MoreThanOrEqual, Not } from 'typeorm';
import { KycLevel, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { KycStepName } from '../enums/kyc-step-name.enum';
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
        name: Not(KycStepName.CONTACT_DATA),
        status: KycStepStatus.IN_PROGRESS,
        updated: LessThan(Util.daysBefore(Config.kyc.reminderAfterDays)),
        userData: {
          kycLevel: MoreThanOrEqual(0) && LessThan(50),
          status: In([UserDataStatus.NA, UserDataStatus.ACTIVE, UserDataStatus.KYC_ONLY]),
        },
      },
      relations: { userData: { wallet: true } },
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
              wallet: entity.userData.wallet,
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

  async identFailed(userData: UserData, reason: string): Promise<void> {
    try {
      if ((userData.mail, !DisabledProcess(Process.KYC_MAIL))) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: MailContext.KYC_FAILED,
          input: {
            userData,
            wallet: userData.wallet,
            title: `${MailTranslationKey.KYC_FAILED}.title`,
            salutation: { key: `${MailTranslationKey.KYC_FAILED}.salutation` },
            suffix: [
              { key: MailKey.SPACE, params: { value: '1' } },
              {
                key: `${MailTranslationKey.KYC_FAILED}.message`,
                params: {
                  reason,
                },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.KYC}.retry`,
                params: {
                  url: userData.kycUrl,
                  urlText: userData.kycUrl,
                },
              },
              {
                key: `${MailTranslationKey.GENERAL}.button`,
                params: {
                  url: userData.kycUrl,
                },
              },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        !userData.mail &&
          this.logger.warn(`Failed to send ident failed mail for user data ${userData.id}: user has no email`);
      }

      // KYC webhook external services
      await this.webhookService.kycFailed(userData, reason);
    } catch (e) {
      this.logger.error(`Failed to send ident failed mail or webhook for user data ${userData.id}:`, e);
    }
  }

  async kycChanged(userData: UserData, newLevel?: KycLevel): Promise<void> {
    try {
      if (newLevel === KycLevel.LEVEL_50 && !DisabledProcess(Process.KYC_MAIL)) {
        if (userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.KYC_CHANGED,
            input: {
              userData,
              wallet: userData.wallet,
              title: `${MailTranslationKey.KYC_SUCCESS}.title`,
              salutation: { key: `${MailTranslationKey.KYC_SUCCESS}.salutation` },
              suffix: [
                { key: MailKey.SPACE, params: { value: '1' } },
                { key: `${MailTranslationKey.KYC_SUCCESS}.message` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        } else {
          this.logger.warn(`Failed to send KYC completion mail for user data ${userData.id}: user has no email`);
        }
      }

      // KYC webhook external services
      await this.webhookService.kycChanged(userData);
    } catch (e) {
      this.logger.error(`Failed to send KYC success mail or KYC changed webhook ${userData.id}:`, e);
    }
  }
}
