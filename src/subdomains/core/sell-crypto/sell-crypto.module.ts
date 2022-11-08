import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { BuyFiatNotificationService } from './buy-fiat/buy-fiat-notification.service';
import { BuyFiatController } from './buy-fiat/buy-fiat.controller';
import { BuyFiatRepository } from './buy-fiat/buy-fiat.repository';
import { BuyFiatService } from './buy-fiat/buy-fiat.service';
import { SellController } from './sell/sell.controller';
import { SellRepository } from './sell/sell.repository';
import { SellService } from './sell/sell.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyFiatRepository, SellRepository]),
    SharedModule,
    forwardRef(() => MixModule),
    UserModule,
    NotificationModule,
    BankModule,
  ],
  controllers: [BuyFiatController, SellController],
  providers: [SellController, BuyFiatNotificationService, BuyFiatService, SellService],
  exports: [SellController, BuyFiatService, SellService],
})
export class SellCryptoModule {}
