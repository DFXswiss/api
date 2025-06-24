import { Injectable } from '@nestjs/common';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportIssueNotificationService {
  constructor(private readonly notificationService: NotificationService, private readonly logger: DfxLoggerService) {
    logger.create(SupportIssueNotificationService);
  }

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (entity.userData.mail && !DisabledProcess(Process.SUPPORT_MESSAGE_MAIL))
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context: MailContext.SUPPORT_MESSAGE,
          input: {
            userData: entity.userData,
            wallet: entity.userData.wallet,
            title: `${MailTranslationKey.SUPPORT_MESSAGE}.title`,
            salutation: { key: `${MailTranslationKey.SUPPORT_MESSAGE}.salutation` },
            texts: [
              {
                key: `${MailTranslationKey.SUPPORT_MESSAGE}.message`,
                params: { url: entity.issue.url, urlText: entity.issue.url },
              },
            ],
          },
        });
    } catch (e) {
      this.logger.error(`Failed to send support message mail for message (${entity.id}):`, e);
    }
  }
}
