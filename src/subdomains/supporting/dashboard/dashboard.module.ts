import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { ReferralModule } from '../../core/referral/referral.module';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { LogModule } from '../log/log.module';
import { CryptoInput } from '../payin/entities/crypto-input.entity';
import { PayoutOrder } from '../payout/entities/payout-order.entity';
import { DashboardFinancialController } from './dashboard-financial.controller';
import { DashboardFinancialService } from './dashboard-financial.service';
import { DashboardReconciliationController } from './dashboard-reconciliation.controller';
import { DashboardReconciliationService } from './dashboard-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, LiquidityManagementOrder, PayoutOrder, ExchangeTx, BankTx, CryptoInput]),
    SharedModule,
    LogModule,
    ReferralModule,
  ],
  controllers: [DashboardFinancialController, DashboardReconciliationController],
  providers: [DashboardFinancialService, DashboardReconciliationService],
})
export class DashboardModule {}
