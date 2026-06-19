import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportIssueNotificationService {
  private readonly logger = new DfxLogger(SupportIssueNotificationService);

  constructor(private readonly notificationService: NotificationService) {}

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (!entity.userData.mail || DisabledProcess(Process.SUPPORT_MESSAGE_MAIL)) return;

      // Mail branding (DFX vs. RealUnit) must follow the exact app the ticket was opened from. Brand
      // strictly by the issue's source wallet and never guess: if the source is unknown, fail closed
      // (skip the mail) rather than send a possibly mis-branded one. Passing the wallet explicitly also
      // bypasses resolveMailWallet's account-history override.
      const wallet = entity.issue.wallet;
      if (!wallet) {
        this.logger.warn(
          `Skipping support message mail for message (${entity.id}): issue (${entity.issue.id}) has no source wallet`,
        );
        return;
      }

      await this.notificationService.sendMail({
        type: MailType.USER_V2,
        context: MailContext.SUPPORT_MESSAGE,
        input: {
          userData: entity.userData,
          wallet,
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
