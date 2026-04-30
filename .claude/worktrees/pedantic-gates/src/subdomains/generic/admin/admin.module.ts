import { Module } from '@nestjs/common';
import { LetterModule } from 'src/integration/letter/letter.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { UserModule } from '../user/user.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

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
    PayInModule,
    DexModule,
    PayoutModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [],
})
export class AdminModule {}
