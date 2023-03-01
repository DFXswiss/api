import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { CryptoStakingRepository } from './repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from './repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from './repositories/staking-reward.repository';
import { StakingRepository } from './repositories/staking.repository';
import { CryptoStakingService } from './services/crypto-staking.service';
import { StakingRefRewardService } from './services/staking-ref-reward.service';
import { StakingReturnService } from './services/staking-return.service';
import { StakingRewardService } from './services/staking-reward.service';
import { StakingService } from './services/staking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StakingRepository,
      StakingRewardRepository,
      StakingRefRewardRepository,
      CryptoStakingRepository,
    ]),
    SharedModule,
    forwardRef(() => PayInModule),
  ],
  controllers: [],
  providers: [
    StakingService,
    StakingReturnService,
    CryptoStakingService,
    StakingRefRewardService,
    StakingRewardService,
  ],
  exports: [StakingService, StakingRewardService, CryptoStakingService, StakingRefRewardService],
})
export class StakingModule {}
