import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailKey, MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportIssueNotificationService {
  private readonly logger = new DfxLogger(SupportIssueNotificationService);

  constructor(private readonly notificationService: NotificationService) {}

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (entity.userData.mail && !DisabledProcess(Process.SUPPORT_MESSAGE_MAIL))
        await this.notificationService.sendMail({
          type: MailType.PERSONAL,
          context: MailContext.SUPPORT_MESSAGE,
          input: {
            userData: entity.userData,
            title: `${MailTranslationKey.SUPPORT_MESSAGE}.title`,
            prefix: [
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: entity.userData.firstname ?? entity.issue.name },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.SUPPORT_MESSAGE}.message`,
                params: { supportMessage: entity.message },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: `${MailTranslationKey.GENERAL}.thanks` },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.GENERAL}.personal_closing`,
                params: { closingName: entity.author },
              },
            ],
            from: Config.support.message.mailAddress,
            displayName: Config.support.message.mailName,
            banner: Config.support.message.mailBanner,
          },
        });
    } catch (e) {
      this.logger.error(`Failed to send support message mail for message (${entity.id}):`, e);
    }
  }
}
