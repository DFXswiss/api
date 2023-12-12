import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, MoreThan } from 'typeorm';
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
    if (Config.processDisabled(Process.KYC_MAIL)) return;
    await this.kycReminder();
  }

  private async kycReminder(): Promise<void> {
    const entities = await this.kycStepRepo.find({
      where: {
        reminderSentDate: IsNull(),
        status: KycStepStatus.IN_PROGRESS,
        updated: MoreThan(Util.daysAfter(Config.kyc.reminderAfterDays)),
      },
      relations: ['userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'kyc reminder' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.userData.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
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
                  params: { url: `${Config.frontend.services}/kyc?code=${entity.userData.kycHash}` },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.KYC}.last_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        } else {
          this.logger.warn(`Failed to send kyc reminder mail for userData ${entity.userData.id}: user has no email`);
        }

        await this.kycStepRepo.update(...entity.setReminderSentDate());
      } catch (e) {
        this.logger.error(`Failed to send kyc reminder mail for kycStep ${entity.id}:`, e);
      }
    }
  }

  async kycFailed(entity: KycStep): Promise<void> {
    try {
      if ((entity.userData.mail, !Config.processDisabled(Process.KYC_MAIL))) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          input: {
            userData: entity.userData,
            title: `${MailTranslationKey.KYC_FAILED}.title`,
            salutation: { key: `${MailTranslationKey.KYC_FAILED}.salutation` },
            suffix: [
              { key: MailKey.SPACE, params: { value: '1' } },
              {
                key: `${MailTranslationKey.KYC_FAILED}.message`,
                params: { url: `${Config.frontend.payment}/kyc?code=${entity.userData.kycHash}` },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              { key: `${MailTranslationKey.KYC}.last_step` },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        !entity.userData.mail &&
          this.logger.warn(`Failed to send kyc failed mail for user data ${entity.userData.id}: user has no email`);
      }

      //Kyc webhook external Services
      await this.webhookService.kycFailed(entity.userData, entity.result);
    } catch (e) {
      this.logger.error(`Failed to send kyc failed mail or webhook ${entity.id}:`, e);
    }
  }

  async kycChanged(userData: UserData, level?: KycLevel): Promise<void> {
    try {
      if (userData.mail && level === KycLevel.LEVEL_50 && !Config.processDisabled(Process.KYC_MAIL)) {
        await this.notificationService.sendMail({
          type: MailType.USER,
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
          this.logger.warn(`Failed to send kyc completion mail for user data ${userData.id}: user has no email`);
      }

      //Kyc webhook external Services
      await this.webhookService.kycChanged(userData);
    } catch (e) {
      this.logger.error(`Failed to send kyc success mail or kyc changed webhook ${userData.id}:`, e);
    }
  }
}
