import { Module } from '@nestjs/common';
import { LetterModule } from 'src/integration/letter/letter.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { StakingModule } from 'src/subdomains/core/staking/staking.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { UserModule } from '../user/user.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    SharedModule,
    ReferralModule,
    BuyCryptoModule,
    SellCryptoModule,
    NotificationModule,
    UserModule,
    LetterModule,
    BankModule,
    StakingModule,
    PayInModule,
  ],
  controllers: [AdminController],
  providers: [],
  exports: [],
})
export class AdminModule {}
