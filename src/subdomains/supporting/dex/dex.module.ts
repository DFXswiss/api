import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DexController } from './dex.controller';
import { LiquidityOrder } from './entities/liquidity-order.entity';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DexArbitrumService } from './services/dex-arbitrum.service';
import { DexBaseService } from './services/dex-base.service';
import { DexBitcoinService } from './services/dex-bitcoin.service';
import { DexBscService } from './services/dex-bsc.service';
import { DexCardanoService } from './services/dex-cardano.service';
import { DexCitreaService } from './services/dex-citrea.service';
import { DexCitreaTestnetService } from './services/dex-citrea-testnet.service';
import { DexEthereumService } from './services/dex-ethereum.service';
import { DexGnosisService } from './services/dex-gnosis.service';
import { DexLightningService } from './services/dex-lightning.service';
import { DexMoneroService } from './services/dex-monero.service';
import { DexOptimismService } from './services/dex-optimism.service';
import { DexPolygonService } from './services/dex-polygon.service';
import { DexSepoliaService } from './services/dex-sepolia.service';
import { DexSolanaService } from './services/dex-solana.service';
import { DexTronService } from './services/dex-tron.service';
import { DexZanoService } from './services/dex-zano.service';
import { DexService } from './services/dex.service';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyCL } from './strategies/check-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyCL } from './strategies/check-liquidity/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategyCL } from './strategies/check-liquidity/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategyCL } from './strategies/check-liquidity/impl/base-token.strategy';
import { CheckLiquidityStrategyRegistry } from './strategies/check-liquidity/impl/base/check-liquidity.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyCL } from './strategies/check-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyCL } from './strategies/check-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyCL } from './strategies/check-liquidity/impl/bsc-token.strategy';
import { CardanoCoinStrategy as CardanoCoinStrategyCL } from './strategies/check-liquidity/impl/cardano-coin.strategy';
import { CardanoTokenStrategy as CardanoTokenStrategyCL } from './strategies/check-liquidity/impl/cardano-token.strategy';
import { CitreaCoinStrategy as CitreaCoinStrategyCL } from './strategies/check-liquidity/impl/citrea-coin.strategy';
import { CitreaTokenStrategy as CitreaTokenStrategyCL } from './strategies/check-liquidity/impl/citrea-token.strategy';
import { CitreaTestnetCoinStrategy as CitreaTestnetCoinStrategyCL } from './strategies/check-liquidity/impl/citrea-testnet-coin.strategy';
import { CitreaTestnetTokenStrategy as CitreaTestnetTokenStrategyCL } from './strategies/check-liquidity/impl/citrea-testnet-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyCL } from './strategies/check-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyCL } from './strategies/check-liquidity/impl/ethereum-token.strategy';
import { GnosisCoinStrategy as GnosisCoinStrategyCL } from './strategies/check-liquidity/impl/gnosis-coin.strategy';
import { GnosisTokenStrategy as GnosisTokenStrategyCL } from './strategies/check-liquidity/impl/gnosis-token.strategy';
import { LightningStrategy as LightningStrategyCL } from './strategies/check-liquidity/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyCL } from './strategies/check-liquidity/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyCL } from './strategies/check-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyCL } from './strategies/check-liquidity/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategyCL } from './strategies/check-liquidity/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategyCL } from './strategies/check-liquidity/impl/polygon-token.strategy';
import { SepoliaCoinStrategy as SepoliaCoinStrategyCL } from './strategies/check-liquidity/impl/sepolia-coin.strategy';
import { SepoliaTokenStrategy as SepoliaTokenStrategyCL } from './strategies/check-liquidity/impl/sepolia-token.strategy';
import { SolanaCoinStrategy as SolanaCoinStrategyCL } from './strategies/check-liquidity/impl/solana-coin.strategy';
import { SolanaTokenStrategy as SolanaTokenStrategyCL } from './strategies/check-liquidity/impl/solana-token.strategy';
import { TronCoinStrategy as TronCoinStrategyCL } from './strategies/check-liquidity/impl/tron-coin.strategy';
import { TronTokenStrategy as TronTokenStrategyCL } from './strategies/check-liquidity/impl/tron-token.strategy';
import { ZanoCoinStrategy as ZanoCoinStrategyCL } from './strategies/check-liquidity/impl/zano-coin.strategy';
import { ZanoTokenStrategy as ZanoTokenStrategyCL } from './strategies/check-liquidity/impl/zano-token.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyPL } from './strategies/purchase-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyPL } from './strategies/purchase-liquidity/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategyPL } from './strategies/purchase-liquidity/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategyPL } from './strategies/purchase-liquidity/impl/base-token.strategy';
import { PurchaseLiquidityStrategyRegistry } from './strategies/purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyPL } from './strategies/purchase-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyPL } from './strategies/purchase-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPL } from './strategies/purchase-liquidity/impl/bsc-token.strategy';
import { CardanoCoinStrategy as CardanoCoinStrategyPL } from './strategies/purchase-liquidity/impl/cardano-coin.strategy';
import { CardanoTokenStrategy as CardanoTokenStrategyPL } from './strategies/purchase-liquidity/impl/cardano-token.strategy';
import { CitreaCoinStrategy as CitreaCoinStrategyPL } from './strategies/purchase-liquidity/impl/citrea-coin.strategy';
import { CitreaTokenStrategy as CitreaTokenStrategyPL } from './strategies/purchase-liquidity/impl/citrea-token.strategy';
import { CitreaTestnetCoinStrategy as CitreaTestnetCoinStrategyPL } from './strategies/purchase-liquidity/impl/citrea-testnet-coin.strategy';
import { CitreaTestnetTokenStrategy as CitreaTestnetTokenStrategyPL } from './strategies/purchase-liquidity/impl/citrea-testnet-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-token.strategy';
import { GnosisCoinStrategy as GnosisCoinStrategyPL } from './strategies/purchase-liquidity/impl/gnosis-coin.strategy';
import { GnosisTokenStrategy as GnosisTokenStrategyPL } from './strategies/purchase-liquidity/impl/gnosis-token.strategy';
import { MoneroStrategy as MoneroStrategyPL } from './strategies/purchase-liquidity/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyPL } from './strategies/purchase-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyPL } from './strategies/purchase-liquidity/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategyPL } from './strategies/purchase-liquidity/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategyPL } from './strategies/purchase-liquidity/impl/polygon-token.strategy';
import { SepoliaCoinStrategy as SepoliaCoinStrategyPL } from './strategies/purchase-liquidity/impl/sepolia-coin.strategy';
import { SepoliaTokenStrategy as SepoliaTokenStrategyPL } from './strategies/purchase-liquidity/impl/sepolia-token.strategy';
import { SolanaCoinStrategy as SolanaCoinStrategyPL } from './strategies/purchase-liquidity/impl/solana-coin.strategy';
import { SolanaTokenStrategy as SolanaTokenStrategyPL } from './strategies/purchase-liquidity/impl/solana-token.strategy';
import { TronCoinStrategy as TronCoinStrategyPL } from './strategies/purchase-liquidity/impl/tron-coin.strategy';
import { TronTokenStrategy as TronTokenStrategyPL } from './strategies/purchase-liquidity/impl/tron-token.strategy';
import { ZanoCoinStrategy as ZanoCoinStrategyPL } from './strategies/purchase-liquidity/impl/zano-coin.strategy';
import { ZanoTokenStrategy as ZanoTokenStrategyPL } from './strategies/purchase-liquidity/impl/zano-token.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategySL } from './strategies/sell-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategySL } from './strategies/sell-liquidity/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategySL } from './strategies/sell-liquidity/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategySL } from './strategies/sell-liquidity/impl/base-token.strategy';
import { SellLiquidityStrategyRegistry } from './strategies/sell-liquidity/impl/base/sell-liquidity.strategy-registry';
import { BitcoinStrategy as BitcoinStrategySL } from './strategies/sell-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategySL } from './strategies/sell-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategySL } from './strategies/sell-liquidity/impl/bsc-token.strategy';
import { CardanoCoinStrategy as CardanoCoinStrategySL } from './strategies/sell-liquidity/impl/cardano-coin.strategy';
import { CardanoTokenStrategy as CardanoTokenStrategySL } from './strategies/sell-liquidity/impl/cardano-token.strategy';
import { CitreaCoinStrategy as CitreaCoinStrategySL } from './strategies/sell-liquidity/impl/citrea-coin.strategy';
import { CitreaTokenStrategy as CitreaTokenStrategySL } from './strategies/sell-liquidity/impl/citrea-token.strategy';
import { CitreaTestnetCoinStrategy as CitreaTestnetCoinStrategySL } from './strategies/sell-liquidity/impl/citrea-testnet-coin.strategy';
import { CitreaTestnetTokenStrategy as CitreaTestnetTokenStrategySL } from './strategies/sell-liquidity/impl/citrea-testnet-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategySL } from './strategies/sell-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategySL } from './strategies/sell-liquidity/impl/ethereum-token.strategy';
import { GnosisCoinStrategy as GnosisCoinStrategySL } from './strategies/sell-liquidity/impl/gnosis-coin.strategy';
import { GnosisTokenStrategy as GnosisTokenStrategySL } from './strategies/sell-liquidity/impl/gnosis-token.strategy';
import { MoneroStrategy as MoneroStrategySL } from './strategies/sell-liquidity/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategySL } from './strategies/sell-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategySL } from './strategies/sell-liquidity/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategySL } from './strategies/sell-liquidity/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategySL } from './strategies/sell-liquidity/impl/polygon-token.strategy';
import { SepoliaCoinStrategy as SepoliaCoinStrategySL } from './strategies/sell-liquidity/impl/sepolia-coin.strategy';
import { SepoliaTokenStrategy as SepoliaTokenStrategySL } from './strategies/sell-liquidity/impl/sepolia-token.strategy';
import { SolanaCoinStrategy as SolanaCoinStrategySL } from './strategies/sell-liquidity/impl/solana-coin.strategy';
import { SolanaTokenStrategy as SolanaTokenStrategySL } from './strategies/sell-liquidity/impl/solana-token.strategy';
import { TronCoinStrategy as TronCoinStrategySL } from './strategies/sell-liquidity/impl/tron-coin.strategy';
import { TronTokenStrategy as TronTokenStrategySL } from './strategies/sell-liquidity/impl/tron-token.strategy';
import { ZanoCoinStrategy as ZanoCoinStrategySL } from './strategies/sell-liquidity/impl/zano-coin.strategy';
import { ZanoTokenStrategy as ZanoTokenStrategySL } from './strategies/sell-liquidity/impl/zano-token.strategy';
import { ArbitrumStrategy as ArbitrumStrategyS } from './strategies/supplementary/impl/arbitrum.strategy';
import { BaseStrategy as BaseStrategyS } from './strategies/supplementary/impl/base.strategy';
import { SupplementaryStrategyRegistry } from './strategies/supplementary/impl/base/supplementary.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyS } from './strategies/supplementary/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyS } from './strategies/supplementary/impl/bsc.strategy';
import { CardanoStrategy as CardanoStrategyS } from './strategies/supplementary/impl/cardano.strategy';
import { CitreaStrategy as CitreaStrategyS } from './strategies/supplementary/impl/citrea.strategy';
import { CitreaTestnetStrategy as CitreaTestnetStrategyS } from './strategies/supplementary/impl/citrea-testnet.strategy';
import { EthereumStrategy as EthereumStrategyS } from './strategies/supplementary/impl/ethereum.strategy';
import { GnosisStrategy as GnosisStrategyS } from './strategies/supplementary/impl/gnosis.strategy';
import { MoneroStrategy as MoneroStrategyS } from './strategies/supplementary/impl/monero.strategy';
import { OptimismStrategy as OptimismStrategyS } from './strategies/supplementary/impl/optimism.strategy';
import { PolygonStrategy as PolygonStrategyS } from './strategies/supplementary/impl/polygon.strategy';
import { SepoliaStrategy as SepoliaStrategyS } from './strategies/supplementary/impl/sepolia.strategy';
import { SolanaStrategy as SolanaStrategyS } from './strategies/supplementary/impl/solana.strategy';
import { TronStrategy as TronStrategyS } from './strategies/supplementary/impl/tron.strategy';
import { ZanoStrategy as ZanoStrategyS } from './strategies/supplementary/impl/zano.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrder]), BlockchainModule, NotificationModule, SharedModule],
  controllers: [DexController],
  providers: [
    LiquidityOrderRepository,
    DexService,
    LiquidityOrderFactory,
    DexEthereumService,
    DexSepoliaService,
    DexArbitrumService,
    DexOptimismService,
    DexPolygonService,
    DexBaseService,
    DexGnosisService,
    DexBscService,
    DexBitcoinService,
    DexCitreaService,
    DexCitreaTestnetService,
    DexLightningService,
    DexMoneroService,
    DexZanoService,
    DexSolanaService,
    DexTronService,
    DexCardanoService,
    CheckLiquidityStrategyRegistry,
    PurchaseLiquidityStrategyRegistry,
    SellLiquidityStrategyRegistry,
    SupplementaryStrategyRegistry,
    ArbitrumCoinStrategyCL,
    ArbitrumTokenStrategyCL,
    EthereumCoinStrategyCL,
    BscCoinStrategyCL,
    BitcoinStrategyCL,
    LightningStrategyCL,
    MoneroStrategyCL,
    ZanoCoinStrategyCL,
    ZanoTokenStrategyCL,
    BscTokenStrategyCL,
    EthereumTokenStrategyCL,
    SepoliaCoinStrategyCL,
    SepoliaTokenStrategyCL,
    OptimismCoinStrategyCL,
    OptimismTokenStrategyCL,
    PolygonCoinStrategyCL,
    PolygonTokenStrategyCL,
    BaseCoinStrategyCL,
    BaseTokenStrategyCL,
    CitreaCoinStrategyCL,
    CitreaTokenStrategyCL,
    CitreaTestnetCoinStrategyCL,
    CitreaTestnetTokenStrategyCL,
    SolanaCoinStrategyCL,
    SolanaTokenStrategyCL,
    GnosisCoinStrategyCL,
    GnosisTokenStrategyCL,
    TronCoinStrategyCL,
    TronTokenStrategyCL,
    CardanoCoinStrategyCL,
    CardanoTokenStrategyCL,
    EthereumCoinStrategyPL,
    BscCoinStrategyPL,
    BitcoinStrategyPL,
    MoneroStrategyPL,
    ZanoCoinStrategyPL,
    ZanoTokenStrategyPL,
    ArbitrumCoinStrategyPL,
    ArbitrumTokenStrategyPL,
    BscTokenStrategyPL,
    EthereumTokenStrategyPL,
    SepoliaCoinStrategyPL,
    SepoliaTokenStrategyPL,
    OptimismCoinStrategyPL,
    OptimismTokenStrategyPL,
    PolygonCoinStrategyPL,
    PolygonTokenStrategyPL,
    BaseCoinStrategyPL,
    BaseTokenStrategyPL,
    CitreaCoinStrategyPL,
    CitreaTokenStrategyPL,
    CitreaTestnetCoinStrategyPL,
    CitreaTestnetTokenStrategyPL,
    SolanaCoinStrategyPL,
    SolanaTokenStrategyPL,
    GnosisCoinStrategyPL,
    GnosisTokenStrategyPL,
    TronCoinStrategyPL,
    TronTokenStrategyPL,
    CardanoCoinStrategyPL,
    CardanoTokenStrategyPL,
    BitcoinStrategySL,
    MoneroStrategySL,
    ZanoCoinStrategySL,
    ZanoTokenStrategySL,
    ArbitrumCoinStrategySL,
    ArbitrumTokenStrategySL,
    BscCoinStrategySL,
    BscTokenStrategySL,
    EthereumCoinStrategySL,
    EthereumTokenStrategySL,
    SepoliaCoinStrategySL,
    SepoliaTokenStrategySL,
    OptimismCoinStrategySL,
    OptimismTokenStrategySL,
    PolygonCoinStrategySL,
    PolygonTokenStrategySL,
    BaseCoinStrategySL,
    BaseTokenStrategySL,
    CitreaCoinStrategySL,
    CitreaTokenStrategySL,
    CitreaTestnetCoinStrategySL,
    CitreaTestnetTokenStrategySL,
    SolanaCoinStrategySL,
    SolanaTokenStrategySL,
    GnosisCoinStrategySL,
    GnosisTokenStrategySL,
    TronCoinStrategySL,
    TronTokenStrategySL,
    CardanoCoinStrategySL,
    CardanoTokenStrategySL,
    ArbitrumStrategyS,
    BitcoinStrategyS,
    MoneroStrategyS,
    ZanoStrategyS,
    BscStrategyS,
    EthereumStrategyS,
    SepoliaStrategyS,
    OptimismStrategyS,
    PolygonStrategyS,
    BaseStrategyS,
    CitreaStrategyS,
    CitreaTestnetStrategyS,
    SolanaStrategyS,
    GnosisStrategyS,
    TronStrategyS,
    CardanoStrategyS,
  ],
  exports: [DexService],
})
export class DexModule {}
