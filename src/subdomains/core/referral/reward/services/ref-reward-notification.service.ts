import { Injectable } from '@nestjs/common';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';

@Injectable()
export class RefRewardNotificationService {
  private readonly logger = new DfxLogger(RefRewardNotificationService);

  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    if (DisabledProcess(Process.REF_REWARD_MAIL)) return;

    await this.refRewardPayouts();
  }

  private async refRewardPayouts(): Promise<void> {
    const entities = await this.refRewardRepo.find({
      where: {
        mailSendDate: IsNull(),
        outputAmount: Not(IsNull()),
        status: RewardStatus.COMPLETE,
        recipientMail: IsNull(),
        targetAddress: Not(IsNull()),
        targetBlockchain: Not(IsNull()),
      },
      relations: { user: { userData: true, wallet: true } },
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'ref reward' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.user.userData.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            context: MailContext.REF_REWARD,
            input: {
              userData: entity.user.userData,
              wallet: entity.user.wallet,
              title: `${MailTranslationKey.REFERRAL}.title`,
              salutation: { key: `${MailTranslationKey.REFERRAL}.salutation` },
              table: {
                [`${MailTranslationKey.REFERRAL}.output_amount`]: `${entity.outputAmount} ${entity.outputAsset}`,
                [`${MailTranslationKey.PAYMENT}.blockchain`]: entity.targetBlockchain,
                [`${MailTranslationKey.PAYMENT}.wallet_address`]: Util.blankStart(entity.targetAddress),
                [`${MailTranslationKey.PAYMENT}.transaction_id`]: entity.isLightningTransaction
                  ? Util.blankStart(entity.txId)
                  : null,
              },
              suffix: [
                entity.isLightningTransaction
                  ? null
                  : {
                      key: `${MailTranslationKey.REFERRAL}.payment_link`,
                      params: { url: txExplorerUrl(entity.targetBlockchain, entity.txId) },
                    },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: `${MailTranslationKey.REFERRAL}.dfx_ambassador` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });
        } else {
          this.logger.warn(`Failed to send ref reward mails ${entity.id}: user has no email`);
        }

        await this.refRewardRepo.update(...entity.sendMail());
      } catch (e) {
        this.logger.error(`Failed to send ref reward mail ${entity.id}:`, e);
      }
    }
  }
}
