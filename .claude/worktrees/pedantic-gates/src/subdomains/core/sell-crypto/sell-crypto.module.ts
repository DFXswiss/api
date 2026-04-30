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
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { AmlModule } from '../aml/aml.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { CustodyModule } from '../custody/custody.module';
import { RouteModule } from '../route/route.module';
import { TransactionUtilModule } from '../transaction/transaction-util.module';
import { BuyFiatController } from './process/buy-fiat.controller';
import { BuyFiat } from './process/buy-fiat.entity';
import { BuyFiatRepository } from './process/buy-fiat.repository';
import { BuyFiatJobService } from './process/services/buy-fiat-job.service';
import { BuyFiatNotificationService } from './process/services/buy-fiat-notification.service';
import { BuyFiatPreparationService } from './process/services/buy-fiat-preparation.service';
import { BuyFiatRegistrationService } from './process/services/buy-fiat-registration.service';
import { BuyFiatService } from './process/services/buy-fiat.service';
import { SellController } from './route/sell.controller';
import { Sell } from './route/sell.entity';
import { SellRepository } from './route/sell.repository';
import { SellService } from './route/sell.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyFiat, Sell]),
    SharedModule,
    forwardRef(() => UserModule),
    NotificationModule,
    forwardRef(() => PaymentModule),
    BlockchainModule,
    forwardRef(() => BankModule),
    forwardRef(() => BankTxModule),
    forwardRef(() => PayInModule),
    PayoutModule,
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => AddressPoolModule),
    FiatOutputModule,
    PricingModule,
    forwardRef(() => TransactionModule),
    AmlModule,
    forwardRef(() => TransactionUtilModule),
    RouteModule,
    forwardRef(() => CustodyModule),
    SupportIssueModule,
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
    BuyFiatJobService,
  ],
  exports: [SellController, BuyFiatService, SellService],
})
export class SellCryptoModule {}
