import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { EthereumModule } from 'src/blockchain/eth/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutService } from './services/payout.service';
import { PayoutDFIStrategy } from './strategies/payout-dfi.strategy';
import { PayoutTokenStrategy } from './strategies/payout-token.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrderRepository]), AinModule, EthereumModule, SharedModule, DexModule],
  controllers: [],
  providers: [PayoutOrderFactory, PayoutService, PayoutDeFiChainService, PayoutDFIStrategy, PayoutTokenStrategy],
  exports: [PayoutService],
})
export class PayoutModule {}
