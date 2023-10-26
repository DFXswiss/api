import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { StakingModule } from '../staking/staking.module';
import { HistoryController } from './controllers/history.controller';
import { HistoryService } from './services/history.service';

@Module({
  imports: [SharedModule, BuyCryptoModule, ReferralModule, SellCryptoModule, UserModule, AinModule, StakingModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [],
})
export class HistoryModule {}
