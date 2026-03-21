import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-rule.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PricingModule } from '../pricing/pricing.module';
import { BalanceController } from './controllers/balance.controller';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { BalancePdfService } from './services/balance-pdf.service';
import { ReconciliationService } from './services/reconciliation.service';

@Module({
  imports: [
    SharedModule,
    AlchemyModule,
    PricingModule,
    TypeOrmModule.forFeature([
      Log,
      Asset,
      Bank,
      LiquidityManagementOrder,
      LiquidityManagementPipeline,
      LiquidityManagementRule,
      PayoutOrder,
      ExchangeTx,
      BankTx,
      CryptoInput,
    ]),
  ],
  controllers: [BalanceController, ReconciliationController],
  providers: [BalancePdfService, ReconciliationService],
  exports: [BalancePdfService],
})
export class BalanceModule {}
