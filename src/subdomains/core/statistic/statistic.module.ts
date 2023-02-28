import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { IpLogRepository } from 'src/subdomains/generic/user/models/ip-log/ip-log.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { MasternodeModule } from 'src/subdomains/supporting/masternode/masternode.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { StakingModule } from '../staking/staking.module';
import { CfpService } from './cfp.service';
import { StatisticController } from './statistic.controller';
import { StatisticService } from './statistic.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IpLogRepository]),
    SharedModule,
    BuyCryptoModule,
    SellCryptoModule,
    ReferralModule,
    UserModule,
    AinModule,
    MasternodeModule,
    StakingModule,
  ],
  controllers: [StatisticController],
  providers: [StatisticService, CfpService],
  exports: [],
})
export class StatisticModule {}
