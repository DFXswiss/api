import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DexModule } from '../dex/dex.module';
import { PricingModule } from '../pricing/pricing.module';
import { PayoutOrder } from './entities/payout-order.entity';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutController } from './payout.controller';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutArbitrumService } from './services/payout-arbitrum.service';
import { PayoutBaseService } from './services/payout-base.service';
import { PayoutBitcoinService } from './services/payout-bitcoin.service';
import { PayoutBscService } from './services/payout-bsc.service';
import { PayoutCitreaTestnetService } from './services/payout-citrea-testnet.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutGnosisService } from './services/payout-gnosis.service';
import { PayoutLightningService } from './services/payout-lightning.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutMoneroService } from './services/payout-monero.service';
import { PayoutOptimismService } from './services/payout-optimism.service';
import { PayoutPolygonService } from './services/payout-polygon.service';
import { PayoutSolanaService } from './services/payout-solana.service';
import { PayoutTronService } from './services/payout-tron.service';
import { PayoutZanoService } from './services/payout-zano.service';
import { PayoutService } from './services/payout.service';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyPO } from './strategies/payout/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyPO } from './strategies/payout/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategyPO } from './strategies/payout/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategyPO } from './strategies/payout/impl/base-token.strategy';
import { PayoutStrategyRegistry } from './strategies/payout/impl/base/payout.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyPO } from './strategies/payout/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyPO } from './strategies/payout/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPO } from './strategies/payout/impl/bsc-token.strategy';
import { CitreaTestnetCoinStrategy as CitreaTestnetCoinStrategyPO } from './strategies/payout/impl/citrea-testnet-coin.strategy';
import { CitreaTestnetTokenStrategy as CitreaTestnetTokenStrategyPO } from './strategies/payout/impl/citrea-testnet-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyPO } from './strategies/payout/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPO } from './strategies/payout/impl/ethereum-token.strategy';
import { GnosisCoinStrategy as GnosisCoinStrategyPO } from './strategies/payout/impl/gnosis-coin.strategy';
import { GnosisTokenStrategy as GnosisTokenStrategyPO } from './strategies/payout/impl/gnosis-token.strategy';
import { LightningStrategy as LightningStrategyPO } from './strategies/payout/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyPO } from './strategies/payout/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyPO } from './strategies/payout/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyPO } from './strategies/payout/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategyPO } from './strategies/payout/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategyPO } from './strategies/payout/impl/polygon-token.strategy';
import { SolanaCoinStrategy as SolanaCoinStrategyPO } from './strategies/payout/impl/solana-coin.strategy';
import { SolanaTokenStrategy as SolanaTokenStrategyPO } from './strategies/payout/impl/solana-token.strategy';
import { TronCoinStrategy as TronCoinStrategyPO } from './strategies/payout/impl/tron-coin.strategy';
import { TronTokenStrategy as TronTokenStrategyPO } from './strategies/payout/impl/tron-token.strategy';
import { ZanoStrategy as ZanoStrategyPO } from './strategies/payout/impl/zano.strategy';
import { ArbitrumStrategy as ArbitrumStrategyPR } from './strategies/prepare/impl/arbitrum.strategy';
import { BaseStrategy as BaseStrategyPR } from './strategies/prepare/impl/base.strategy';
import { PrepareStrategyRegistry } from './strategies/prepare/impl/base/prepare.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyPR } from './strategies/prepare/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyPR } from './strategies/prepare/impl/bsc.strategy';
import { CitreaTestnetStrategy as CitreaTestnetStrategyPR } from './strategies/prepare/impl/citrea-testnet.strategy';
import { EthereumStrategy as EthereumStrategyPR } from './strategies/prepare/impl/ethereum.strategy';
import { GnosisStrategy as GnosisStrategyPR } from './strategies/prepare/impl/gnosis.strategy';
import { LightningStrategy as LightningStrategyPR } from './strategies/prepare/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyPR } from './strategies/prepare/impl/monero.strategy';
import { OptimismStrategy as OptimismStrategyPR } from './strategies/prepare/impl/optimism.strategy';
import { PolygonStrategy as PolygonStrategyPR } from './strategies/prepare/impl/polygon.strategy';
import { SolanaStrategy as SolanaStrategyPR } from './strategies/prepare/impl/solana.strategy';
import { TronStrategy as TronStrategyPR } from './strategies/prepare/impl/tron.strategy';
import { ZanoStrategy as ZanoStrategyPR } from './strategies/prepare/impl/zano.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayoutOrder]),
    BlockchainModule,
    SharedModule,
    DexModule,
    NotificationModule,
    PricingModule,
  ],
  controllers: [PayoutController],
  providers: [
    PayoutOrderRepository,
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutBitcoinService,
    PayoutLightningService,
    PayoutMoneroService,
    PayoutZanoService,
    PayoutArbitrumService,
    PayoutOptimismService,
    PayoutPolygonService,
    PayoutBaseService,
    PayoutGnosisService,
    PayoutEthereumService,
    PayoutBscService,
    PayoutSolanaService,
    PayoutTronService,
    PayoutCitreaTestnetService,
    PayoutStrategyRegistry,
    PrepareStrategyRegistry,
    BitcoinStrategyPR,
    BitcoinStrategyPO,
    LightningStrategyPR,
    LightningStrategyPO,
    MoneroStrategyPR,
    MoneroStrategyPO,
    ZanoStrategyPR,
    ZanoStrategyPO,
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
    SolanaStrategyPR,
    SolanaCoinStrategyPO,
    SolanaTokenStrategyPO,
    GnosisStrategyPR,
    GnosisCoinStrategyPO,
    GnosisTokenStrategyPO,
    TronStrategyPR,
    TronCoinStrategyPO,
    TronTokenStrategyPO,
    CitreaTestnetStrategyPR,
    CitreaTestnetCoinStrategyPO,
    CitreaTestnetTokenStrategyPO,
  ],
  exports: [PayoutService, PayoutBitcoinService, PayoutMoneroService, PayoutZanoService, PayoutSolanaService],
})
export class PayoutModule {}
