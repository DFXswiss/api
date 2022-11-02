import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MixModule } from 'src/mix/mix.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { BuyCryptoController } from './process/buy-crypto.controller';
import { BuyCryptoBatchRepository } from './process/repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from './process/repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from './process/services/buy-crypto-batch.service';
import { BuyCryptoDexService } from './process/services/buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './process/services/buy-crypto-notification.service';
import { BuyCryptoOutService } from './process/services/buy-crypto-out.service';
import { BuyCryptoPricingService } from './process/services/buy-crypto-pricing.service';
import { BuyCryptoService } from './process/services/buy-crypto.service';
import { BuyController } from './route/buy.controller';
import { BuyRepository } from './route/buy.repository';
import { BuyService } from './route/buy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BuyCryptoRepository, BuyCryptoBatchRepository, BuyRepository]),
    SharedModule,
    DexModule,
    PricingModule,
    PayoutModule,
    NotificationModule,
    UserModule,
    BankModule,
    forwardRef(() => MixModule),
  ],
  controllers: [BuyCryptoController, BuyController],
  providers: [
    BuyController,
    BuyCryptoService,
    BuyCryptoBatchService,
    BuyCryptoDexService,
    BuyCryptoPricingService,
    BuyCryptoNotificationService,
    BuyCryptoOutService,
    BuyService,
  ],
  exports: [BuyController, BuyCryptoService, BuyService],
})
export class BuyCryptoModule {}
