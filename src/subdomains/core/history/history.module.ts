import { Module } from '@nestjs/common';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [SharedModule, BuyCryptoModule, ReferralModule, SellCryptoModule, MixModule, UserModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [],
})
export class HistoryModule {}
