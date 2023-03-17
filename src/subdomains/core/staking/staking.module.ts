import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { CryptoStakingRepository } from './repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from './repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from './repositories/staking-reward.repository';
import { StakingRepository } from './repositories/staking.repository';
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
    NotificationModule,
    forwardRef(() => PayInModule),
  ],
  controllers: [],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}
