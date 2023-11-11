import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserDataRepository } from './user-data.repository';

@Injectable()
export class UserDataNotificationService {
  private readonly logger = new DfxLogger(UserDataNotificationService);

  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    if (Config.processDisabled(Process.BLACK_SQUAD_MAIL)) return;
    await this.blackSquadInvitation();
  }

  private async blackSquadInvitation(): Promise<void> {
    const entities = await this.userDataRepo
      .createQueryBuilder('userData')
      .select('userData')
      .where('userData.blackSquadMailSendDate IS NULL')
      .andWhere('userData.buyVolume + userData.sellVolume + userData.cryptoVolume >= :limit', {
        limit: Config.support.blackSquad.limit,
      })
      .getMany();

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'black squad invitation' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.PERSONAL,
            input: {
              userData: entity,
              title: `${MailTranslationKey.BLACK_SQUAD}.title`,
              prefix: [
                {
                  key: `${MailTranslationKey.GENERAL}.welcome`,
                  params: { name: entity.firstname },
                },
                { key: MailKey.SPACE, params: { value: '1' } },
                { key: `${MailTranslationKey.BLACK_SQUAD}.line1` },
                { key: `${MailTranslationKey.BLACK_SQUAD}.line2` },
                { key: `${MailTranslationKey.BLACK_SQUAD}.line3` },
                { key: `${MailTranslationKey.BLACK_SQUAD}.line4` },
                { key: `${MailTranslationKey.BLACK_SQUAD}.line5` },
                { key: `${MailTranslationKey.BLACK_SQUAD}.closing` },
              ],
              from: Config.support.blackSquad.mailAddress,
              displayName: Config.support.blackSquad.mailName,
              banner: Config.support.blackSquad.mailBanner,
            },
          });
        } else {
          this.logger.warn(`Failed to send black squad invitation mail ${entity.id}: user has no email`);
        }

        await this.userDataRepo.update(...entity.sendMail());
      } catch (e) {
        this.logger.error(`Failed to send black squad invitation initiated mail ${entity.id}:`, e);
      }
    }
  }
}
