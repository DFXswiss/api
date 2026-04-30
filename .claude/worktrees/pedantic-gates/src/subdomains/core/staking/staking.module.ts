import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { CryptoStaking } from './entities/crypto-staking.entity';
import { StakingRefReward } from './entities/staking-ref-reward.entity';
import { StakingReward } from './entities/staking-reward.entity';
import { Staking } from './entities/staking.entity';
import { CryptoStakingRepository } from './repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from './repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from './repositories/staking-reward.repository';
import { StakingRepository } from './repositories/staking.repository';
import { StakingService } from './services/staking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Staking, StakingReward, StakingRefReward, CryptoStaking]),
    SharedModule,
    NotificationModule,
    forwardRef(() => PayInModule),
  ],
  controllers: [],
  providers: [
    StakingRepository,
    StakingRewardRepository,
    StakingRefRewardRepository,
    CryptoStakingRepository,
    StakingService,
  ],
  exports: [StakingService],
})
export class StakingModule {}
