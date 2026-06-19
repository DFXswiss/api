import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
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
    private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
  ) {}

  async newSupportMessage(entity: SupportMessage): Promise<void> {
    try {
      if (entity.userData.mail && !DisabledProcess(Process.SUPPORT_MESSAGE_MAIL)) {
        // wallet the user originated from - determines mail branding (e.g. DFX vs. RealUnit);
        // resolve it explicitly so branding follows the user's source and never falls back to the
        // account-history override (which would brand any RealUnit-linked account as RealUnit, even
        // for DFX support answers). Reload via the user (cached) because not every caller eager-loads
        // the wallet relation (e.g. the auto-responder job); fall back to the default (DFX) wallet.
        const wallet =
          (await this.userDataService.getUserData(entity.userData.id, { wallet: true }, true))?.wallet ??
          (await this.walletService.getDefault());

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
      }
    } catch (e) {
      this.logger.error(`Failed to send support message mail for message (${entity.id}):`, e);
    }
  }
}
