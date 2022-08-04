import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutService } from './services/payout.service';
import { PayoutDFIStrategy } from './strategies/payout-dfi.strategy';
import { PayoutTokenStrategy } from './strategies/payout-token.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrderRepository]), AinModule, SharedModule],
  controllers: [],
  providers: [PayoutOrderFactory, PayoutService, PayoutDFIStrategy, PayoutTokenStrategy],
  exports: [],
})
export class PayoutModule {}
