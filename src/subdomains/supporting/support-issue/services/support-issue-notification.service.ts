import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportIssueNotificationService {
  private readonly logger = new DfxLogger(SupportIssueNotificationService);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly walletService: WalletService,
  ) {}

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (!entity.userData.mail || DisabledProcess(Process.SUPPORT_MESSAGE_MAIL)) return;

      // Mail branding follows the app the ticket was opened from (set on the issue at creation from the
      // trusted X-Client signal): RealUnit-app tickets carry the RealUnit wallet, everything else defaults
      // to DFX. Passing the wallet explicitly also bypasses resolveMailWallet's account-history override.
      const wallet = entity.issue.wallet ?? (await this.walletService.getDefault());

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
