import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { StakingModule } from '../staking/staking.module';
import { BuyFiatNotificationService } from './process/buy-fiat-notification.service';
import { BuyFiatRegistrationService } from './process/buy-fiat-registration.service';
import { BuyFiatController } from './process/buy-fiat.controller';
import { BuyFiatRepository } from './process/buy-fiat.repository';
import { BuyFiatService } from './process/buy-fiat.service';
import { SellController } from './route/sell.controller';
import { SellRepository } from './route/sell.repository';
import { SellService } from './route/sell.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyFiatRepository, SellRepository]),
    SharedModule,
    UserModule,
    NotificationModule,
    forwardRef(() => BankModule),
    forwardRef(() => PayInModule),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => StakingModule),
    forwardRef(() => AddressPoolModule),
  ],
  controllers: [BuyFiatController, SellController],
  providers: [SellController, BuyFiatNotificationService, BuyFiatRegistrationService, BuyFiatService, SellService],
  exports: [SellController, BuyFiatService, SellService],
})
export class SellCryptoModule {}
