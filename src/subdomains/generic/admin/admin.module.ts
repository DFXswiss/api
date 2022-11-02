import { Module } from '@nestjs/common';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { UserModule } from '../user/user.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [SharedModule, ReferralModule, BuyCryptoModule, SellCryptoModule, NotificationModule, UserModule, MixModule],
  controllers: [AdminController],
  providers: [],
  exports: [],
})
export class AdminModule {}
