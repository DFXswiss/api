import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DexService } from './services/dex.service';
import { LiquidityService } from './services/liquidity.service';
import { CheckLiquidityDefaultStrategy } from './strategies/check-liquidity/check-liquidity-default.strategy';
import { CheckPoolPairLiquidityStrategy } from './strategies/check-liquidity/check-poolpair-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from './strategies/purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchasePoolPairLiquidityStrategy } from './strategies/purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './strategies/purchase-liquidity/purchase-stock-liquidity.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, SharedModule],
  controllers: [],
  providers: [
    LiquidityService,
    LiquidityOrderFactory,
    DexService,
    CheckPoolPairLiquidityStrategy,
    CheckLiquidityDefaultStrategy,
    PurchaseCryptoLiquidityStrategy,
    PurchasePoolPairLiquidityStrategy,
    PurchaseStockLiquidityStrategy,
  ],
  exports: [DexService],
})
export class DexModule {}
