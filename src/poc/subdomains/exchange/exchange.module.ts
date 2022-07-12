import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { PaymentModule } from 'src/payment/payment.module';
import { GetReferencePricesHandler } from './handlers/get-reference-prices.handler';
import { SecureLiquidityHandler } from './handlers/secure-liquidity.handler';
import { DefichainDexLiquidityService } from './services/defichain/defichain-dex-liquidity.service';
import { SecureNonReferenceLiquidityStrategy } from './strategies/secure-non-ref-liquidity.strategy';
import { SecureReferenceAssetLiquidityStrategy } from './strategies/secure-ref-liquidity.strategy';

@Module({
  imports: [CqrsModule, PaymentModule],
  controllers: [],
  providers: [
    GetReferencePricesHandler,
    SecureNonReferenceLiquidityStrategy,
    SecureReferenceAssetLiquidityStrategy,
    SecureLiquidityHandler,
    DefichainDexLiquidityService,
  ],
  exports: [],
})
export class ExchangeModule {}
