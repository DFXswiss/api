import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StakingRepository } from 'src/mix/models/staking/staking.repository';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { StakingReturnService } from './services/staking-return.service';
import { StakingService } from './services/staking.service';

@Module({
  imports: [TypeOrmModule.forFeature([StakingRepository]), PayInModule],
  providers: [StakingService, StakingReturnService],
})
export class StakingModule {}
