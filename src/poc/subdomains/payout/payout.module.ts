import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { DoPayoutHandler } from './handlers/do-payout.handler';
import { PreparePayoutHandler } from './handlers/prepare-payout.handler';
import { PocPayoutOrderRepository } from './repositories/payout-order.repository';
import { DeFiChainPayoutService } from './services/defichain/defichain-payout.service';
import { PayoutDFIStrategy } from './strategies/defichain/payout-dfi.strategy';
import { PayoutTokenStrategy } from './strategies/defichain/payout-token.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PocPayoutOrderRepository]), CqrsModule, AinModule],
  controllers: [],
  providers: [DeFiChainPayoutService, PreparePayoutHandler, DoPayoutHandler, PayoutDFIStrategy, PayoutTokenStrategy],
  exports: [],
})
export class PayoutModule {}
