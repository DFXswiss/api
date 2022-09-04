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
import { PayoutDeFiChainDFIStrategy } from './strategies/payout/payout-defichain-dfi.strategy';
import { PayoutEthereumStrategy } from './strategies/payout/payout-ethereum.strategy';
import { PayoutDeFiChainTokenStrategy } from './strategies/payout/payout-defichain-token.strategy';
import { PrepareBSCStrategy } from './strategies/prepare/prepare-bsc.strategy';
import { PrepareDeFiChainStrategy } from './strategies/prepare/prepare-defichain.strategy';
import { PrepareEthereumStrategy } from './strategies/prepare/prepare-ethereum.strategy';
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
    PayoutDeFiChainDFIStrategy,
    PayoutDeFiChainTokenStrategy,
    PayoutEthereumStrategy,
    PayoutBSCStrategy,
    PrepareDeFiChainStrategy,
    PrepareEthereumStrategy,
    PrepareBSCStrategy,
    PayoutStrategiesFacade,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
