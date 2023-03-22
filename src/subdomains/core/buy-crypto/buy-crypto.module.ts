import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoRouteRepository } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.repository';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { BuyCryptoController } from './process/buy-crypto.controller';
import { BuyCryptoBatchRepository } from './process/repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from './process/repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from './process/services/buy-crypto-batch.service';
import { BuyCryptoDexService } from './process/services/buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './process/services/buy-crypto-notification.service';
import { BuyCryptoOutService } from './process/services/buy-crypto-out.service';
import { BuyCryptoPricingService } from './process/services/buy-crypto-pricing.service';
import { BuyCryptoRegistrationService } from './process/services/buy-crypto-registration.service';
import { BuyCryptoService } from './process/services/buy-crypto.service';
import { CryptoRouteController } from './routes/crypto-route/crypto-route.controller';
import { BuyRepository } from './routes/buy/buy.repository';
import { BuyController } from './routes/buy/buy.controller';
import { CryptoRouteService } from './routes/crypto-route/crypto-route.service';
import { BuyService } from './routes/buy/buy.service';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyCryptoRepository, BuyCryptoBatchRepository, BuyRepository, CryptoRouteRepository]),
    SharedModule,
    DexModule,
    PricingModule,
    PayInModule,
    PayoutModule,
    NotificationModule,
    UserModule,
    BankModule,
    AinModule,
    forwardRef(() => SellCryptoModule),
    forwardRef(() => AddressPoolModule),
  ],
  controllers: [BuyCryptoController, BuyController, CryptoRouteController],
  providers: [
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
    CryptoRouteService,
  ],
  exports: [BuyController, CryptoRouteController, BuyCryptoService, BuyService],
})
export class BuyCryptoModule {}
