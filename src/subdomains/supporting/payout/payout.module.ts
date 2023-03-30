import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutBscService } from './services/payout-bsc.service';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutService } from './services/payout.service';
import { PayoutStrategiesFacade } from './strategies/payout/payout.facade';
import { PayoutBitcoinService } from './services/payout-bitcoin.service';
import { PrepareStrategiesFacade } from './strategies/prepare/prepare.facade';
import { BitcoinStrategy as BitcoinStrategyPO } from './strategies/payout/impl/bitcoin.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyPO } from './strategies/payout/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyPO } from './strategies/payout/impl/arbitrum-token.strategy';
import { BscCoinStrategy as BscCoinStrategyPO } from './strategies/payout/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPO } from './strategies/payout/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainDfiStrategyPO } from './strategies/payout/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategyPO } from './strategies/payout/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyPO } from './strategies/payout/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPO } from './strategies/payout/impl/ethereum-token.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyPO } from './strategies/payout/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyPO } from './strategies/payout/impl/optimism-token.strategy';
import { BitcoinStrategy as BitcoinStrategyPR } from './strategies/prepare/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyPR } from './strategies/prepare/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyPR } from './strategies/prepare/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyPR } from './strategies/prepare/impl/ethereum.strategy';
import { ArbitrumStrategy as ArbitrumStrategyPR } from './strategies/prepare/impl/arbitrum.strategy';
import { OptimismStrategy as OptimismStrategyPR } from './strategies/prepare/impl/optimism.strategy';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayoutController } from './payout.controller';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { PayoutOptimismService } from './services/payout-optimism.service';
import { PayoutArbitrumService } from './services/payout-arbitrum.service';
import { PayoutOrder } from './entities/payout-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrder]), BlockchainModule, SharedModule, DexModule, NotificationModule],
  controllers: [PayoutController],
  providers: [
    PayoutOrderRepository,
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutBitcoinService,
    PayoutArbitrumService,
    PayoutOptimismService,
    PayoutDeFiChainService,
    PayoutEthereumService,
    PayoutBscService,
    PayoutStrategiesFacade,
    PrepareStrategiesFacade,
    BitcoinStrategyPO,
    ArbitrumCoinStrategyPO,
    ArbitrumTokenStrategyPO,
    BscCoinStrategyPO,
    BscTokenStrategyPO,
    DeFiChainDfiStrategyPO,
    DeFiChainTokenStrategyPO,
    EthereumCoinStrategyPO,
    EthereumTokenStrategyPO,
    OptimismCoinStrategyPO,
    OptimismTokenStrategyPO,
    BitcoinStrategyPR,
    BscStrategyPR,
    DeFiChainStrategyPR,
    EthereumStrategyPR,
    ArbitrumStrategyPR,
    OptimismStrategyPR,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
