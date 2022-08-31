import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { BSCModule } from 'src/blockchain/bsc/bsc.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutBSCService } from './services/payout-bsc.service';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutService } from './services/payout.service';
import { PayoutBSCStrategy } from './strategies/payout/payout-bsc.strategy';
import { PayoutDFIStrategy } from './strategies/payout/payout-dfi.strategy';
import { PayoutETHStrategy } from './strategies/payout/payout-eth.strategy';
import { PayoutTokenStrategy } from './strategies/payout/payout-token.strategy';
import { PrepareOnBSCStrategy } from './strategies/prepare/prepare-on-bsc.strategy';
import { PrepareOnDefichainStrategy } from './strategies/prepare/prepare-on-defichain.strategy';
import { PrepareOnEthereumStrategy } from './strategies/prepare/prepare-on-ethereum.strategy';
import { PayoutStrategiesFacade } from './strategies/strategies.facade';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayoutOrderRepository]),
    AinModule,
    EthereumModule,
    BSCModule,
    SharedModule,
    DexModule,
  ],
  controllers: [],
  providers: [
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutDeFiChainService,
    PayoutEthereumService,
    PayoutBSCService,
    PayoutDFIStrategy,
    PayoutTokenStrategy,
    PayoutETHStrategy,
    PayoutBSCStrategy,
    PrepareOnDefichainStrategy,
    PrepareOnEthereumStrategy,
    PrepareOnBSCStrategy,
    PayoutStrategiesFacade,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
