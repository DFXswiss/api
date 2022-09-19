import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { BscModule } from 'src/blockchain/bsc/bsc.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutBscService } from './services/payout-bsc.service';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutService } from './services/payout.service';
import { PayoutBscStrategy } from './strategies/payout/payout-bsc.strategy';
import { PayoutDeFiChainDFIStrategy } from './strategies/payout/payout-defichain-dfi.strategy';
import { PayoutEthereumStrategy } from './strategies/payout/payout-ethereum.strategy';
import { PayoutDeFiChainTokenStrategy } from './strategies/payout/payout-defichain-token.strategy';
import { PrepareBscStrategy } from './strategies/prepare/prepare-bsc.strategy';
import { PrepareDeFiChainStrategy } from './strategies/prepare/prepare-defichain.strategy';
import { PrepareEthereumStrategy } from './strategies/prepare/prepare-ethereum.strategy';
import { PayoutStrategiesFacade } from './strategies/strategies.facade';
import { NotificationModule } from 'src/notification/notification.module';
import { PayoutController } from './payout.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayoutOrderRepository]),
    AinModule,
    EthereumModule,
    BscModule,
    SharedModule,
    DexModule,
    NotificationModule,
  ],
  controllers: [PayoutController],
  providers: [
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutDeFiChainService,
    PayoutEthereumService,
    PayoutBscService,
    PayoutDeFiChainDFIStrategy,
    PayoutDeFiChainTokenStrategy,
    PayoutEthereumStrategy,
    PayoutBscStrategy,
    PrepareDeFiChainStrategy,
    PrepareEthereumStrategy,
    PrepareBscStrategy,
    PayoutStrategiesFacade,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
