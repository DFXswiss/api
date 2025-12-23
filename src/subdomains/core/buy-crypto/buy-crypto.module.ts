import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationModule } from 'src/integration/integration.module';
import { SiftModule } from 'src/integration/sift/sift.module';
import { SharedModule } from 'src/shared/shared.module';
import { SwapRepository } from 'src/subdomains/core/buy-crypto/routes/swap/swap.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { FiatOutputModule } from 'src/subdomains/supporting/fiat-output/fiat-output.module';
import { FiatPayInModule } from 'src/subdomains/supporting/fiat-payin/fiat-payin.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { AmlModule } from '../aml/aml.module';
import { CustodyModule } from '../custody/custody.module';
import { LiquidityManagementModule } from '../liquidity-management/liquidity-management.module';
import { RouteModule } from '../route/route.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { TransactionUtilModule } from '../transaction/transaction-util.module';
import { BuyCryptoController } from './process/buy-crypto.controller';
import { BuyCryptoBatch } from './process/entities/buy-crypto-batch.entity';
import { BuyCryptoFee } from './process/entities/buy-crypto-fees.entity';
import { BuyCrypto } from './process/entities/buy-crypto.entity';
import { BuyCryptoBatchRepository } from './process/repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from './process/repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from './process/services/buy-crypto-batch.service';
import { BuyCryptoDexService } from './process/services/buy-crypto-dex.service';
import { BuyCryptoJobService } from './process/services/buy-crypto-job.service';
import { BuyCryptoNotificationService } from './process/services/buy-crypto-notification.service';
import { BuyCryptoOutService } from './process/services/buy-crypto-out.service';
import { BuyCryptoPreparationService } from './process/services/buy-crypto-preparation.service';
import { BuyCryptoPricingService } from './process/services/buy-crypto-pricing.service';
import { BuyCryptoRegistrationService } from './process/services/buy-crypto-registration.service';
import { BuyCryptoWebhookService } from './process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from './process/services/buy-crypto.service';
import { BuyController } from './routes/buy/buy.controller';
import { Buy } from './routes/buy/buy.entity';
import { BuyRepository } from './routes/buy/buy.repository';
import { BuyService } from './routes/buy/buy.service';
import { CryptoRouteController } from './routes/swap/crypto-route.controller';
import { SwapController } from './routes/swap/swap.controller';
import { Swap } from './routes/swap/swap.entity';
import { SwapService } from './routes/swap/swap.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyCrypto, BuyCryptoBatch, BuyCryptoFee, Buy, Swap]),
    SharedModule,
    DexModule,
    PricingModule,
    PayInModule,
    PayoutModule,
    NotificationModule,
    forwardRef(() => UserModule),
    BankModule,
    forwardRef(() => BankTxModule),
    forwardRef(() => PaymentModule),
    forwardRef(() => SellCryptoModule),
    forwardRef(() => AddressPoolModule),
    LiquidityManagementModule,
    IntegrationModule,
    forwardRef(() => TransactionModule),
    forwardRef(() => AmlModule),
    forwardRef(() => FiatPayInModule),
    SiftModule,
    FiatOutputModule,
    forwardRef(() => TransactionUtilModule),
    forwardRef(() => RouteModule),
    forwardRef(() => CustodyModule),
  ],
  controllers: [BuyCryptoController, BuyController, CryptoRouteController, SwapController],
  providers: [
    BuyCryptoRepository,
    BuyCryptoBatchRepository,
    BuyRepository,
    SwapRepository,
    SwapController,
    CryptoRouteController,
    BuyController,
    BuyCryptoService,
    BuyCryptoBatchService,
    BuyCryptoDexService,
    BuyCryptoPricingService,
    BuyCryptoRegistrationService,
    BuyCryptoNotificationService,
    BuyCryptoOutService,
    BuyService,
    SwapService,
    BuyCryptoWebhookService,
    BuyCryptoPreparationService,
    BuyCryptoJobService,
  ],
  exports: [BuyController, SwapController, BuyCryptoService, BuyService, BuyCryptoWebhookService, SwapService],
})
export class BuyCryptoModule {}
