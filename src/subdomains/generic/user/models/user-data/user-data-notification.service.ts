import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';

@Injectable()
export class UserDataNotificationService {
  private readonly logger = new DfxLogger(UserDataNotificationService);

  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.BLACK_SQUAD_MAIL, timeout: 1800 })
  async sendNotificationMails(): Promise<void> {
    await this.blackSquadInvitation();
  }

  async userDataAddedAddressInfo(master: UserData, slave: UserData): Promise<void> {
    try {
      if (master.mail) {
        for (const user of slave.users) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.ADDED_ADDRESS,
            input: {
              userData: master,
              wallet: master.wallet,
              title: `${MailTranslationKey.ACCOUNT_MERGE_ADDED_ADDRESS}.title`,
              salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_ADDED_ADDRESS}.salutation` },
              prefix: [
                { key: MailKey.SPACE, params: { value: '3' } },
                {
                  key: `${MailTranslationKey.GENERAL}.welcome`,
                  params: { name: master.organizationName ?? master.firstname },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                {
                  key: `${MailTranslationKey.ACCOUNT_MERGE_ADDED_ADDRESS}.message`,
                  params: { userAddress: Util.blankStart(user.address) },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
              ],
              suffix: [{ key: MailKey.SPACE, params: { value: '4' } }, { key: MailKey.DFX_TEAM_CLOSING }],
            },
          });
        }
      } else {
        this.logger.warn(`Failed to send userData (${master.id}) added address info mail: user has no email`);
      }
    } catch (e) {
      this.logger.error(
        `Failed to send userData added address info mail slave (${slave.id}) and master (${master.id}):`,
        e,
      );
    }
  }

  async userDataChangedMailInfo(master: UserData, slave: UserData): Promise<void> {
    try {
      if (master.mail)
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: MailContext.CHANGED_MAIL,
          input: {
            userData: master,
            wallet: master.wallet,
            title: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.title`,
            salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.salutation` },
            prefix: [
              { key: MailKey.SPACE, params: { value: '3' } },
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: master.organizationName ?? master.firstname },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.message`,
                params: { userMail: Util.blankMail(slave.mail) },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
            ],
            suffix: [{ key: MailKey.SPACE, params: { value: '4' } }, { key: MailKey.DFX_TEAM_CLOSING }],
          },
        });

      await this.notificationService.sendMail({
        type: MailType.USER,
        context: MailContext.CHANGED_MAIL,
        input: {
          userData: slave,
          wallet: slave.wallet,
          title: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.title`,
          salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.salutation` },
          prefix: [
            { key: MailKey.SPACE, params: { value: '3' } },
            {
              key: `${MailTranslationKey.GENERAL}.welcome`,
              params: { name: slave.organizationName ?? slave.firstname },
            },
            { key: MailKey.SPACE, params: { value: '2' } },
            {
              key: `${MailTranslationKey.ACCOUNT_MERGE_CHANGED_MAIL}.message`,
              params: { userMail: Util.blankMail(slave.mail) },
            },
            { key: MailKey.SPACE, params: { value: '4' } },
          ],
          suffix: [{ key: MailKey.SPACE, params: { value: '4' } }, { key: MailKey.DFX_TEAM_CLOSING }],
        },
      });
    } catch (e) {
      this.logger.error(`Failed to send userData changed mail info slave (${slave.id}) and master (${master.id}):`, e);
    }
  }

  private async blackSquadInvitation(): Promise<void> {
    const entities = await this.userDataRepo
      .createQueryBuilder('userData')
      .select('userData')
      .leftJoinAndSelect('userData.language', 'language')
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
            context: MailContext.BLACK_SQUAD,
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
