import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { PayoutType, StakingReward } from '../entities/staking-reward.entity';
import { StakingRewardRepository } from '../repositories/staking-reward.repository';
import { Between, In, IsNull, Not } from 'typeorm';
import { StakingRefReward } from '../entities/staking-ref-reward.entity';
import { StakingRefRewardRepository } from '../repositories/staking-ref-reward.repository';
import { CryptoStaking } from '../entities/crypto-staking.entity';
import { CryptoStakingRepository } from '../repositories/crypto-staking.repository';
import { StakingRepository } from '../repositories/staking.repository';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Staking } from '../entities/staking.entity';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { Util } from 'src/shared/utils/util';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config, Process } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';

@Injectable()
export class StakingService {
  private readonly logger = new DfxLogger(StakingService);

  constructor(
    private readonly stakingRewardRepo: StakingRewardRepository,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly stakingRepository: StakingRepository,
    private readonly payInService: PayInService,
    private readonly notificationService: NotificationService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkCryptoPayIn() {
    if (Config.processDisabled(Process.STAKING)) return;
    await this.returnStakingPayIn();
  }

  //*** HISTORY METHODS ***/

  async getUserStakingRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['staking', 'staking.user'],
      order: { id: 'ASC' },
    });
  }

  async getUserStakingRefRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingRefReward[]> {
    return this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['user'],
    });
  }

  async getUserInvests(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ deposits: CryptoStaking[]; withdrawals: CryptoStaking[] }> {
    const cryptoStaking = await this.cryptoStakingRepo.find({
      where: [
        { stakingRoute: { user: { id: userId } }, inputDate: Between(dateFrom, dateTo), isReinvest: false },
        {
          stakingRoute: { user: { id: userId } },
          outputDate: Between(dateFrom, dateTo),
          payoutType: Not(PayoutType.REINVEST),
        },
      ],
      relations: ['cryptoInput', 'stakingRoute', 'stakingRoute.user'],
      order: { id: 'ASC' },
    });

    return {
      deposits: cryptoStaking.filter(
        (entry) => entry.inputDate >= dateFrom && entry.inputDate <= dateTo && !entry.isReinvest,
      ),
      withdrawals: cryptoStaking.filter(
        (entry) =>
          entry.outTxId &&
          entry.outputDate >= dateFrom &&
          entry.outputDate <= dateTo &&
          entry.payoutType !== PayoutType.REINVEST,
      ),
    };
  }

  //*** RETURN STAKING METHODS ***/

  async returnStakingPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const stakingPayIns = await this.filterStakingPayIns(newPayIns);
    await this.returnPayIns(stakingPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterStakingPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Staking][]> {
    const stakings = await this.stakingRepository.find({
      where: { deposit: Not(IsNull()) },
      relations: ['deposit', 'user', 'user.userData'],
    });

    return this.pairRoutesWithPayIns(stakings, allPayIns);
  }

  private pairRoutesWithPayIns(stakings: Staking[], allPayIns: CryptoInput[]): [CryptoInput, Staking][] {
    const result = [];

    for (const staking of stakings) {
      const relevantPayIn = allPayIns.find(
        (p) => p.address.address === staking.deposit.address && p.address.blockchain === staking.deposit.blockchain,
      );

      relevantPayIn && result.push([relevantPayIn, staking]);
    }

    return result;
  }

  private async returnPayIns(payInsPairs: [CryptoInput, Staking][]): Promise<void> {
    for (const [payIn, staking] of payInsPairs) {
      //send mail
      try {
        if (staking.user.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER,
            input: {
              userData: staking.user.userData,
              translationKey: 'mail.staking.return',
              translationParams: {
                inputAmount: payIn.amount,
                inputAsset: payIn.asset.name,
                userAddressTrimmed: Util.blankBlockchainAddress(staking.user.address),
                transactionLink: txExplorerUrl(payIn.asset.blockchain, payIn.inTxId),
              },
            },
          });
        }
      } catch (e) {
        this.logger.error(`Failed to send staking return mail for pay-in ${payIn.id}:`, e);
      }

      await this.payInService.returnPayIn(
        payIn.id,
        PayInPurpose.STAKING,
        BlockchainAddress.create(staking.user.address, staking.deposit.blockchain),
        staking,
      );
    }
  }
}
