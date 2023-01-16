import { Injectable } from '@nestjs/common';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { Staking } from '../entities/staking.entity';
import { StakingRepository } from '../repositories/staking.repository';

@Injectable()
export class StakingReturnService {
  constructor(private readonly stakingRepository: StakingRepository, private readonly payInService: PayInService) {}

  async returnStakingPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const stakingPayIns = await this.filterStakingPayIns(newPayIns);
    await this.returnPayIns(stakingPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterStakingPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Staking][]> {
    const stakings = await this.stakingRepository.find({ where: { deposit: Not(IsNull()) }, relations: ['deposit'] });

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
    for (const [payIn, _] of payInsPairs) {
      await this.payInService.returnPayIn(payIn, PayInPurpose.STAKING);
    }
  }
}
