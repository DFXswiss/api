import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailTranslationKey } from '../../notification/factories/mail.factory';
import { REALUNIT_WALLET_NAME } from '../../notification/realunit-mail-rules';
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

      // Mail branding follows the app the ticket was opened from, attributed at creation from the trusted
      // inbound X-Client signal (NOT the user's persisted wallet): RealUnit-app tickets carry the RealUnit
      // wallet. Every other client defaults to DFX - X-Client is a RealUnit-only header today, so the whole
      // DFX ecosystem (web app, dfx-wallet, OCP, integrators) legitimately has no source. DFX-as-default is
      // the intended house brand, but the miss is logged so it is observable, not silent.
      // Passing the wallet explicitly also bypasses resolveMailWallet's account-history override.
      let wallet = entity.issue.wallet;
      if (!wallet) {
        wallet = await this.walletService.getDefault();
        this.logger.verbose(
          `Support message mail for issue ${entity.issue.id}: no attributed source, branding DFX default`,
        );
      } else if (wallet.name === REALUNIT_WALLET_NAME && !Config.mail.wallet[REALUNIT_WALLET_NAME]) {
        // RealUnit was positively attributed, but its mail config is absent (REALUNIT_MAIL_USER unset): the
        // factory would silently render the DFX default template. Surface the misconfiguration loudly.
        this.logger.warn(
          `Support message mail for issue ${entity.issue.id} is RealUnit-attributed but REALUNIT_MAIL_USER is unset; rendering DFX default template`,
        );
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
