import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationModule } from 'src/integration/integration.module';
import { SharedModule } from 'src/shared/shared.module';
import { CheckoutTx } from './entities/checkout-tx.entity';
import { CheckoutTxRepository } from './repositories/checkout-tx.repository';
import { FiatPayInSyncService } from './services/fiat-payin-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([CheckoutTx]), SharedModule, IntegrationModule],
  providers: [CheckoutTxRepository, FiatPayInSyncService],
  controllers: [],
  exports: [],
})
export class FiatPayInModule {}
