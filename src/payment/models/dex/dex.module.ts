import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DEXService } from './services/dex.service';
import { SwapLiquidityService } from './services/swap-liquidity.service';
import { PurchaseCryptoLiquidityStrategy } from './strategies/purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchasePoolPairLiquidityStrategy } from './strategies/purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './strategies/purchase-liquidity/purchase-stock-liquidity.strategy';
import { DeFiChainUtil } from './utils/defichain.util';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, SharedModule],
  controllers: [],
  providers: [
    DEXService,
    SwapLiquidityService,
    DeFiChainUtil,
    LiquidityOrderFactory,
    PurchaseCryptoLiquidityStrategy,
    PurchasePoolPairLiquidityStrategy,
    PurchaseStockLiquidityStrategy,
  ],
  exports: [DEXService, DeFiChainUtil],
})
export class DexModule {}
