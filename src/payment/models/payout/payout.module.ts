import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutService } from './services/payout.service';
import { PayoutDFIStrategy } from './strategies/payout/payout-dfi.strategy';
import { PayoutETHStrategy } from './strategies/payout/payout-eth.strategy';
import { PayoutTokenStrategy } from './strategies/payout/payout-token.strategy';
import { PrepareOnDefichainStrategy } from './strategies/prepare/prepare-on-defichain.strategy';
import { PrepareOnEthereumStrategy } from './strategies/prepare/prepare-on-ethereum.strategy';
import { PayoutStrategiesFacade } from './strategies/strategies.facade';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrderRepository]), AinModule, EthereumModule, SharedModule, DexModule],
  controllers: [],
  providers: [
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutDeFiChainService,
    PayoutEthereumService,
    PayoutDFIStrategy,
    PayoutTokenStrategy,
    PayoutETHStrategy,
    PrepareOnDefichainStrategy,
    PrepareOnEthereumStrategy,
    PayoutStrategiesFacade,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
