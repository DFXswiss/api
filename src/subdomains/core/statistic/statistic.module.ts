import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { CfpService } from './cfp.service';
import { StatisticController } from './statistic.controller';
import { StatisticService } from './statistic.service';

@Module({
  imports: [SharedModule, BuyCryptoModule, SellCryptoModule, ReferralModule, MixModule, UserModule, AinModule],
  controllers: [StatisticController],
  providers: [StatisticService, CfpService],
  exports: [],
})
export class StatisticModule {}
