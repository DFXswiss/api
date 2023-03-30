import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DexEthereumService } from './services/dex-ethereum.service';
import { DexService } from './services/dex.service';
import { DexDeFiChainService } from './services/dex-defichain.service';
import { DexBscService } from './services/dex-bsc.service';
import { DexBitcoinService } from './services/dex-bitcoin.service';
import { CheckLiquidityStrategies } from './strategies/check-liquidity/check-liquidity.facade';
import { PurchaseLiquidityStrategies } from './strategies/purchase-liquidity/purchase-liquidity.facade';
import { DeFiChainDefaultStrategy as DeFiChainDefaultStrategyCL } from './strategies/check-liquidity/impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy as DeFiChainPoolPairStrategyCL } from './strategies/check-liquidity/impl/defichain-poolpair.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyCL } from './strategies/check-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyCL } from './strategies/check-liquidity/impl/arbitrum-token.strategy';
import { BitcoinStrategy as BitcoinStrategyCL } from './strategies/check-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyCL } from './strategies/check-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyCL } from './strategies/check-liquidity/impl/bsc-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyCL } from './strategies/check-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyCL } from './strategies/check-liquidity/impl/ethereum-token.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyCL } from './strategies/check-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyCL } from './strategies/check-liquidity/impl/optimism-token.strategy';
import { BitcoinStrategy as BitcoinStrategyPL } from './strategies/purchase-liquidity/impl/bitcoin.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyPL } from './strategies/purchase-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyPL } from './strategies/purchase-liquidity/impl/arbitrum-token.strategy';
import { BscCoinStrategy as BscCoinStrategyPL } from './strategies/purchase-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPL } from './strategies/purchase-liquidity/impl/bsc-token.strategy';
import { DeFiChainDfiStrategy as DeFiChainDfiStrategyPL } from './strategies/purchase-liquidity/impl/defichain-dfi.strategy';
import { DeFiChainCryptoStrategy as DeFiChainCryptoStrategyPL } from './strategies/purchase-liquidity/impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy as DeFiChainPoolPairStrategyPL } from './strategies/purchase-liquidity/impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy as DeFiChainStockStrategyPL } from './strategies/purchase-liquidity/impl/defichain-stock.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-token.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyPL } from './strategies/purchase-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyPL } from './strategies/purchase-liquidity/impl/optimism-token.strategy';
import { BitcoinStrategy as BitcoinStrategySL } from './strategies/sell-liquidity/impl/bitcoin.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategySL } from './strategies/sell-liquidity/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategySL } from './strategies/sell-liquidity/impl/arbitrum-token.strategy';
import { BscCoinStrategy as BscCoinStrategySL } from './strategies/sell-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategySL } from './strategies/sell-liquidity/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainCoinStrategySL } from './strategies/sell-liquidity/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategySL } from './strategies/sell-liquidity/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategySL } from './strategies/sell-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategySL } from './strategies/sell-liquidity/impl/ethereum-token.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategySL } from './strategies/sell-liquidity/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategySL } from './strategies/sell-liquidity/impl/optimism-token.strategy';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DexController } from './dex.controller';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SellLiquidityStrategies } from './strategies/sell-liquidity/sell-liquidity.facade';
import { DexArbitrumService } from './services/dex-arbitrum.service';
import { DexOptimismService } from './services/dex-optimism.service';
import { SupplementaryStrategies } from './strategies/supplementary/supplementary.facade';
import { ArbitrumStrategy as ArbitrumStrategyS } from './strategies/supplementary/impl/arbitrum.strategy';
import { BitcoinStrategy as BitcoinStrategyS } from './strategies/supplementary/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyS } from './strategies/supplementary/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyS } from './strategies/supplementary/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyS } from './strategies/supplementary/impl/ethereum.strategy';
import { OptimismStrategy as OptimismStrategyS } from './strategies/supplementary/impl/optimism.strategy';
import { LiquidityOrder } from './entities/liquidity-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrder]), BlockchainModule, NotificationModule, SharedModule],
  controllers: [DexController],
  providers: [
    LiquidityOrderRepository,
    DexService,
    LiquidityOrderFactory,
    DexDeFiChainService,
    DexEthereumService,
    DexArbitrumService,
    DexOptimismService,
    DexBscService,
    DexBitcoinService,
    CheckLiquidityStrategies,
    PurchaseLiquidityStrategies,
    SellLiquidityStrategies,
    SupplementaryStrategies,
    DeFiChainDefaultStrategyCL,
    DeFiChainPoolPairStrategyCL,
    ArbitrumCoinStrategyCL,
    ArbitrumTokenStrategyCL,
    EthereumCoinStrategyCL,
    BscCoinStrategyCL,
    BitcoinStrategyCL,
    BscTokenStrategyCL,
    EthereumTokenStrategyCL,
    OptimismCoinStrategyCL,
    OptimismTokenStrategyCL,
    DeFiChainDfiStrategyPL,
    DeFiChainCryptoStrategyPL,
    DeFiChainPoolPairStrategyPL,
    DeFiChainStockStrategyPL,
    EthereumCoinStrategyPL,
    BscCoinStrategyPL,
    BitcoinStrategyPL,
    ArbitrumCoinStrategyPL,
    ArbitrumTokenStrategyPL,
    BscTokenStrategyPL,
    EthereumTokenStrategyPL,
    OptimismCoinStrategyPL,
    OptimismTokenStrategyPL,
    BitcoinStrategySL,
    ArbitrumCoinStrategySL,
    ArbitrumTokenStrategySL,
    BscCoinStrategySL,
    BscTokenStrategySL,
    DeFiChainCoinStrategySL,
    DeFiChainTokenStrategySL,
    EthereumCoinStrategySL,
    EthereumTokenStrategySL,
    OptimismCoinStrategySL,
    OptimismTokenStrategySL,
    ArbitrumStrategyS,
    BitcoinStrategyS,
    BscStrategyS,
    DeFiChainStrategyS,
    EthereumStrategyS,
    OptimismStrategyS,
  ],
  exports: [DexService],
})
export class DexModule {}
