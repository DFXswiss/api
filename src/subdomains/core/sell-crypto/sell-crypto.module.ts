import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
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
    forwardRef(() => MixModule),
    UserModule,
    NotificationModule,
    BankModule,
    forwardRef(() => BuyCryptoModule),
  ],
  controllers: [BuyFiatController, SellController],
  providers: [SellController, BuyFiatNotificationService, BuyFiatRegistrationService, BuyFiatService, SellService],
  exports: [SellController, BuyFiatService, SellService],
})
export class SellCryptoModule {}
