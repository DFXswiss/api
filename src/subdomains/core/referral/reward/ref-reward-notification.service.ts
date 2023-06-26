import { Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { RefRewardRepository } from './ref-reward.repository';
import { RewardStatus } from './ref-reward.entity';
import { Util } from 'src/shared/utils/util';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class RefRewardNotificationService {
  private readonly logger = new DfxLogger(RefRewardNotificationService);

  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async sendNotificationMails(): Promise<void> {
    if (Config.processDisabled(Process.REF_REWARD_MAIL)) return;

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
      relations: ['user', 'user.userData'],
    });

    entities.length > 0 && this.logger.verbose(`Sending ${entities.length} 'ref reward' email(s)`);

    for (const entity of entities) {
      try {
        const recipientMail = entity.user.userData.mail;

        if (recipientMail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: entity.user.userData,
              translationKey: 'mail.referral',
              translationParams: {
                outputAmount: entity.outputAmount,
                outputAsset: entity.outputAsset,
                userAddressTrimmed: Util.blankStart(entity.targetAddress),
                transactionLink: txExplorerUrl(entity.targetBlockchain, entity.txId),
              },
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
