import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { PaymentModule } from 'src/payment/payment.module';
import { GetReferencePricesHandler } from './handlers/get-reference-prices.handler';
import { SecureLiquidityHandler } from './handlers/secure-liquidity.handler';
import { PocLiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DeFiChainDexLiquidityService } from './services/defichain/defichain-dex-liquidity.service';
import { NonReferenceLiquiditySwapStrategy } from './strategies/defichain/non-ref-liquidity-swap.strategy';
import { ReferenceLiquiditySwapStrategy } from './strategies/defichain/ref-liquidity-swap.strategy';
import { DeFiChainUtil } from './utils/defichain.util';

@Module({
  imports: [TypeOrmModule.forFeature([PocLiquidityOrderRepository]), CqrsModule, PaymentModule, AinModule],
  controllers: [],
  providers: [
    GetReferencePricesHandler,
    SecureLiquidityHandler,
    ReferenceLiquiditySwapStrategy,
    NonReferenceLiquiditySwapStrategy,
    DeFiChainDexLiquidityService,
    DeFiChainUtil,
  ],
  exports: [],
})
export class ExchangeModule {}
