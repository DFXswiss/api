import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { BscModule } from 'src/blockchain/bsc/bsc.module';
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
import { DeFiChainCryptoStrategy as DeFiChainCryptoStrategyPL } from './strategies/purchase-liquidity/impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy as DeFiChainPoolPairStrategyPL } from './strategies/purchase-liquidity/impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy as DeFiChainStockStrategyPL } from './strategies/purchase-liquidity/impl/defichain-stock.strategy';
import { EthereumCoinStrategy as EthereumCryptoStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-coin.strategy';
import { BscCoinStrategy as BscCryptoStrategyPL } from './strategies/purchase-liquidity/impl/bsc-coin.strategy';
import { BitcoinStrategy as BitcoinStrategyPL } from './strategies/purchase-liquidity/impl/bitcoin.strategy';
import { BscTokenStrategy as BscTokenStrategyPL } from './strategies/purchase-liquidity/impl/bsc-token.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPL } from './strategies/purchase-liquidity/impl/ethereum-token.strategy';
import { NotificationModule } from 'src/notification/notification.module';
import { DexController } from './dex.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LiquidityOrderRepository]),
    AinModule,
    EthereumModule,
    BscModule,
    NotificationModule,
    SharedModule,
  ],
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
  ],
  exports: [DexService],
})
export class DexModule {}
