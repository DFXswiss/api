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
import { CheckLiquidityDefaultStrategy } from './strategies/check-liquidity/check-liquidity-default.strategy';
import { CheckPoolPairLiquidityStrategy } from './strategies/check-liquidity/check-poolpair-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from './strategies/purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchasePoolPairLiquidityStrategy } from './strategies/purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './strategies/purchase-liquidity/purchase-stock-liquidity.strategy';
import { CheckEthereumLiquidityStrategy } from './strategies/check-liquidity/check-liquidity-ethereum.strategy';
import { DexStrategiesFacade } from './strategies/strategies.facade';
import { PurchaseETHLiquidityStrategy } from './strategies/purchase-liquidity/purchase-eth-liquiduity.strategy';
import { BNBModule } from 'src/blockchain/bnb/bnb.module';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, EthereumModule, BNBModule, SharedModule],
  controllers: [],
  providers: [
    LiquidityOrderFactory,
    DexDeFiChainService,
    DexEthereumService,
    DexStrategiesFacade,
    DexService,
    CheckPoolPairLiquidityStrategy,
    CheckLiquidityDefaultStrategy,
    CheckEthereumLiquidityStrategy,
    PurchaseCryptoLiquidityStrategy,
    PurchasePoolPairLiquidityStrategy,
    PurchaseStockLiquidityStrategy,
    PurchaseETHLiquidityStrategy,
  ],
  exports: [DexService],
})
export class DexModule {}
