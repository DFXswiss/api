import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailTranslationKey } from '../../notification/factories/mail.factory';
import { REALUNIT_WALLET_NAME } from '../../notification/realunit-mail-rules';
import { NotificationService } from '../../notification/services/notification.service';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportIssueNotificationService {
  private readonly logger = new DfxLogger(SupportIssueNotificationService);

  constructor(private readonly notificationService: NotificationService) {}

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (!entity.userData.mail || DisabledProcess(Process.SUPPORT_MESSAGE_MAIL)) return;

      // Mail branding follows the app the ticket was opened from, attributed EXACTLY at creation from the
      // X-Client signal (NOT the user's persisted wallet) and persisted NOT NULL. No fallback chain here:
      // an unattributed issue (only possible for rows predating the backfill migration) or a positively
      // RealUnit-attributed issue without its mail config means the correct brand cannot be rendered -
      // fail closed (no mail, error log) instead of guessing a brand.
      // Passing the wallet explicitly also bypasses resolveMailWallet's account-history override.
      const wallet = entity.issue.wallet;
      if (!wallet) {
        this.logger.error(
          `Support message mail for issue ${entity.issue.id} suppressed: issue has no attributed source wallet`,
        );
        return;
      }
      if (wallet.name === REALUNIT_WALLET_NAME && !Config.mail.wallet[REALUNIT_WALLET_NAME]) {
        this.logger.error(
          `Support message mail for issue ${entity.issue.id} suppressed: RealUnit-attributed but REALUNIT_MAIL_USER is unset (would mis-brand as DFX)`,
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
