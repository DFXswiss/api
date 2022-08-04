import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutChainService } from './services/payout-chain.service';
import { PayoutService } from './services/payout.service';
import { PayoutDFIStrategy } from './strategies/payout-dfi.strategy';
import { PayoutTokenStrategy } from './strategies/payout-token.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrderRepository]), AinModule, SharedModule, DexModule],
  controllers: [],
  providers: [PayoutOrderFactory, PayoutService, PayoutChainService, PayoutDFIStrategy, PayoutTokenStrategy],
  exports: [PayoutService],
})
export class PayoutModule {}
