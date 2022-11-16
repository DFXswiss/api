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
import { EthereumCoinStrategy as EthereumCryptoStrategyCL } from './strategies/check-liquidity/impl/ethereum-coin.strategy';
import { BscCoinStrategy as BscCryptoStrategyCL } from './strategies/check-liquidity/impl/bsc-coin.strategy';
import { BitcoinStrategy as BitcoinStrategyCL } from './strategies/check-liquidity/impl/bitcoin.strategy';
import { BscTokenStrategy as BscTokenStrategyCL } from './strategies/check-liquidity/impl/bsc-token.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyCL } from './strategies/check-liquidity/impl/ethereum-token.strategy';
import { BitcoinStrategy as BitcoinStrategyPL } from './strategies/purchase-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCryptoStrategyPL } from './strategies/purchase-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPL } from './strategies/purchase-liquidity/impl/bsc-token.strategy';
import { DeFiChainCryptoStrategy as DeFiChainCryptoStrategyPL } from './strategies/purchase-liquidity/impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy as DeFiChainPoolPairStrategyPL } from './strategies/purchase-liquidity/impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy as DeFiChainStockStrategyPL } from './strategies/purchase-liquidity/impl/defichain-stock.strategy';
import { EthereumCoinStrategy as EthereumCryptoStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-token.strategy';
import { BitcoinStrategy as BitcoinStrategySL } from './strategies/sell-liquidity/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCryptoStrategySL } from './strategies/sell-liquidity/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategySL } from './strategies/sell-liquidity/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainCoinStrategySL } from './strategies/sell-liquidity/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategySL } from './strategies/sell-liquidity/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCryptoStrategySL } from './strategies/sell-liquidity/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategySL } from './strategies/sell-liquidity/impl/ethereum-token.strategy';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DexController } from './dex.controller';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SellLiquidityStrategies } from './strategies/sell-liquidity/sell-liquidity.facade';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), BlockchainModule, NotificationModule, SharedModule],
  controllers: [DexController],
  providers: [
    DexService,
    LiquidityOrderFactory,
    DexDeFiChainService,
    DexEthereumService,
    DexBscService,
    DexBitcoinService,
    CheckLiquidityStrategies,
    PurchaseLiquidityStrategies,
    SellLiquidityStrategies,
    DeFiChainDefaultStrategyCL,
    DeFiChainPoolPairStrategyCL,
    EthereumCryptoStrategyCL,
    BscCryptoStrategyCL,
    BitcoinStrategyCL,
    BscTokenStrategyCL,
    EthereumTokenStrategyCL,
    DeFiChainCryptoStrategyPL,
    DeFiChainPoolPairStrategyPL,
    DeFiChainStockStrategyPL,
    EthereumCryptoStrategyPL,
    BscCryptoStrategyPL,
    BitcoinStrategyPL,
    BscTokenStrategyPL,
    EthereumTokenStrategyPL,
    BitcoinStrategySL,
    BscCryptoStrategySL,
    BscTokenStrategySL,
    DeFiChainCoinStrategySL,
    DeFiChainTokenStrategySL,
    EthereumCryptoStrategySL,
    EthereumTokenStrategySL,
  ],
  exports: [DexService],
})
export class DexModule {}
