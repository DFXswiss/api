import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { FiatOutputModule } from 'src/subdomains/supporting/fiat-output/fiat-output.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { BuyFiatNotificationService } from './process/buy-fiat-notification.service';
import { BuyFiatPreparationService } from './process/buy-fiat-preparation.service';
import { BuyFiatRegistrationService } from './process/buy-fiat-registration.service';
import { BuyFiatController } from './process/buy-fiat.controller';
import { BuyFiat } from './process/buy-fiat.entity';
import { BuyFiatRepository } from './process/buy-fiat.repository';
import { BuyFiatService } from './process/buy-fiat.service';
import { SellController } from './route/sell.controller';
import { Sell } from './route/sell.entity';
import { SellRepository } from './route/sell.repository';
import { SellService } from './route/sell.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyFiat, Sell]),
    SharedModule,
    UserModule,
    NotificationModule,
    PaymentModule,
    BlockchainModule,
    forwardRef(() => BankModule),
    forwardRef(() => BankTxModule),
    forwardRef(() => PayInModule),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => AddressPoolModule),
    FiatOutputModule,
    PricingModule,
  ],
  controllers: [BuyFiatController, SellController],
  providers: [
    BuyFiatRepository,
    SellRepository,
    SellController,
    BuyFiatNotificationService,
    BuyFiatRegistrationService,
    BuyFiatService,
    SellService,
    BuyFiatPreparationService,
  ],
  exports: [SellController, BuyFiatService, SellService],
})
export class SellCryptoModule {}
