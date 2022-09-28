import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DexEthereumService } from './services/dex-ethereum.service';
import { DexService } from './services/dex.service';
import { DexDeFiChainService } from './services/dex-defichain.service';
import { CheckLiquidityDeFiChainDefaultStrategy } from './strategies/check-liquidity/check-liquidity-defichain-default.strategy';
import { CheckLiquidityDeFiChainPoolPairStrategy } from './strategies/check-liquidity/check-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityDeFiChainCryptoStrategy } from './strategies/purchase-liquidity/purchase-liquidity-defichain-crypto.strategy';
import { PurchaseLiquidityDeFiChainPoolPairStrategy } from './strategies/purchase-liquidity/purchase-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityDeFiChainStockStrategy } from './strategies/purchase-liquidity/purchase-liquidity-defichain-stock.strategy';
import { CheckLiquidityEthereumCryptoStrategy } from './strategies/check-liquidity/check-liquidity-ethereum-crypto.strategy';
import { DexStrategiesFacade } from './strategies/strategies.facade';
import { PurchaseLiquidityEthereumCryptoStrategy } from './strategies/purchase-liquidity/purchase-liquidity-ethereum-crypto.strategy';
import { BscModule } from 'src/blockchain/bsc/bsc.module';
import { DexBscService } from './services/dex-bsc.service';
import { PurchaseLiquidityBscCryptoStrategy } from './strategies/purchase-liquidity/purchase-liquidity-bsc-crypto.strategy';
import { CheckLiquidityBscCryptoStrategy } from './strategies/check-liquidity/check-liquidity-bsc-crypto.strategy';
import { DexBitcoinService } from './services/dex-bitcoin.service';
import { CheckLiquidityBitcoinStrategy } from './strategies/check-liquidity/check-liquidity-bitcoin.strategy';
import { CheckLiquidityBscTokenStrategy } from './strategies/check-liquidity/check-liquidity-bsc-token.strategy';
import { CheckLiquidityEthereumTokenStrategy } from './strategies/check-liquidity/check-liquidity-ethereum-token.strategy';
import { PurchaseLiquidityBitcoinStrategy } from './strategies/purchase-liquidity/purchase-liquidity-bitcoin.strategy';
import { PurchaseLiquidityBscTokenStrategy } from './strategies/purchase-liquidity/purchase-liquidity-bsc-token.strategy';
import { PurchaseLiquidityEthereumTokenStrategy } from './strategies/purchase-liquidity/purchase-liquidity-ethereum-token.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, EthereumModule, BscModule, SharedModule],
  controllers: [],
  providers: [
    LiquidityOrderFactory,
    DexDeFiChainService,
    DexEthereumService,
    DexBscService,
    DexBitcoinService,
    DexStrategiesFacade,
    DexService,
    CheckLiquidityBitcoinStrategy,
    CheckLiquidityBscCryptoStrategy,
    CheckLiquidityBscTokenStrategy,
    CheckLiquidityDeFiChainPoolPairStrategy,
    CheckLiquidityDeFiChainDefaultStrategy,
    CheckLiquidityEthereumCryptoStrategy,
    CheckLiquidityEthereumTokenStrategy,
    PurchaseLiquidityBitcoinStrategy,
    PurchaseLiquidityBscCryptoStrategy,
    PurchaseLiquidityBscTokenStrategy,
    PurchaseLiquidityDeFiChainCryptoStrategy,
    PurchaseLiquidityDeFiChainPoolPairStrategy,
    PurchaseLiquidityDeFiChainStockStrategy,
    PurchaseLiquidityEthereumCryptoStrategy,
    PurchaseLiquidityEthereumTokenStrategy,
  ],
  exports: [DexService],
})
export class DexModule {}
