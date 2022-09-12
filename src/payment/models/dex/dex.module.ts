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
import { CheckLiquidityEthereumStrategy } from './strategies/check-liquidity/check-liquidity-ethereum.strategy';
import { DexStrategiesFacade } from './strategies/strategies.facade';
import { PurchaseLiquidityEthereumStrategy } from './strategies/purchase-liquidity/purchase-liquidity-ethereum.strategy';
import { BscModule } from 'src/blockchain/bsc/bsc.module';
import { DexBscService } from './services/dex-bsc.service';
import { PurchaseLiquidityBscStrategy } from './strategies/purchase-liquidity/purchase-liquidity-bsc.strategy';
import { CheckLiquidityBscStrategy } from './strategies/check-liquidity/check-liquidity-bsc.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, EthereumModule, BscModule, SharedModule],
  controllers: [],
  providers: [
    LiquidityOrderFactory,
    DexDeFiChainService,
    DexEthereumService,
    DexBscService,
    DexStrategiesFacade,
    DexService,
    CheckLiquidityDeFiChainPoolPairStrategy,
    CheckLiquidityDeFiChainDefaultStrategy,
    CheckLiquidityEthereumStrategy,
    CheckLiquidityBscStrategy,
    PurchaseLiquidityDeFiChainCryptoStrategy,
    PurchaseLiquidityDeFiChainPoolPairStrategy,
    PurchaseLiquidityDeFiChainStockStrategy,
    PurchaseLiquidityEthereumStrategy,
    PurchaseLiquidityBscStrategy,
  ],
  exports: [DexService],
})
export class DexModule {}
