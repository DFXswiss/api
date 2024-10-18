import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrder } from './entities/payout-order.entity';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutController } from './payout.controller';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutArbitrumService } from './services/payout-arbitrum.service';
import { PayoutBaseService } from './services/payout-base.service';
import { PayoutBitcoinService } from './services/payout-bitcoin.service';
import { PayoutBscService } from './services/payout-bsc.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLightningService } from './services/payout-lightning.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutMoneroService } from './services/payout-monero.service';
import { PayoutOptimismService } from './services/payout-optimism.service';
import { PayoutPolygonService } from './services/payout-polygon.service';
import { PayoutService } from './services/payout.service';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyPO } from './strategies/payout/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyPO } from './strategies/payout/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategyPO } from './strategies/payout/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategyPO } from './strategies/payout/impl/base-token.strategy';
import { PayoutStrategyRegistry } from './strategies/payout/impl/base/payout.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyPO } from './strategies/payout/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyPO } from './strategies/payout/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPO } from './strategies/payout/impl/bsc-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyPO } from './strategies/payout/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPO } from './strategies/payout/impl/ethereum-token.strategy';
import { LightningStrategy as LightningStrategyPO } from './strategies/payout/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyPO } from './strategies/payout/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyPO } from './strategies/payout/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyPO } from './strategies/payout/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategyPO } from './strategies/payout/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategyPO } from './strategies/payout/impl/polygon-token.strategy';
import { ArbitrumStrategy as ArbitrumStrategyPR } from './strategies/prepare/impl/arbitrum.strategy';
import { BaseStrategy as BaseStrategyPR } from './strategies/prepare/impl/base.strategy';
import { PrepareStrategyRegistry } from './strategies/prepare/impl/base/prepare.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyPR } from './strategies/prepare/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyPR } from './strategies/prepare/impl/bsc.strategy';
import { EthereumStrategy as EthereumStrategyPR } from './strategies/prepare/impl/ethereum.strategy';
import { LightningStrategy as LightningStrategyPR } from './strategies/prepare/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyPR } from './strategies/prepare/impl/monero.strategy';
import { OptimismStrategy as OptimismStrategyPR } from './strategies/prepare/impl/optimism.strategy';
import { PolygonStrategy as PolygonStrategyPR } from './strategies/prepare/impl/polygon.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutOrder]), BlockchainModule, SharedModule, DexModule, NotificationModule],
  controllers: [PayoutController],
  providers: [
    PayoutOrderRepository,
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutBitcoinService,
    PayoutLightningService,
    PayoutMoneroService,
    PayoutArbitrumService,
    PayoutOptimismService,
    PayoutPolygonService,
    PayoutBaseService,
    PayoutEthereumService,
    PayoutBscService,
    PayoutStrategyRegistry,
    PrepareStrategyRegistry,
    BitcoinStrategyPR,
    BitcoinStrategyPO,
    LightningStrategyPR,
    LightningStrategyPO,
    MoneroStrategyPR,
    MoneroStrategyPO,
    EthereumStrategyPR,
    EthereumCoinStrategyPO,
    EthereumTokenStrategyPO,
    BscStrategyPR,
    BscCoinStrategyPO,
    BscTokenStrategyPO,
    ArbitrumStrategyPR,
    ArbitrumCoinStrategyPO,
    ArbitrumTokenStrategyPO,
    OptimismStrategyPR,
    OptimismCoinStrategyPO,
    OptimismTokenStrategyPO,
    PolygonStrategyPR,
    PolygonCoinStrategyPO,
    PolygonTokenStrategyPO,
    BaseStrategyPR,
    BaseCoinStrategyPO,
    BaseTokenStrategyPO,
  ],
  exports: [PayoutService, PayoutMoneroService],
})
export class PayoutModule {}
