import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationModule } from 'src/integration/integration.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { CheckoutTx } from './entities/checkout-tx.entity';
import { CheckoutTxRepository } from './repositories/checkout-tx.repository';
import { CheckoutTxService } from './services/checkout-tx.service';
import { FiatPayInSyncService } from './services/fiat-payin-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CheckoutTx]),
    SharedModule,
    IntegrationModule,
    forwardRef(() => BuyCryptoModule),
    NotificationModule,
    UserModule,
  ],
  providers: [CheckoutTxRepository, FiatPayInSyncService, CheckoutTxService],
  controllers: [],
  exports: [CheckoutTxService],
})
export class FiatPayInModule {}
