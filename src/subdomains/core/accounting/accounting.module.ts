import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { LedgerController } from './controllers/ledger.controller';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerLeg } from './entities/ledger-leg.entity';
import { LedgerTx } from './entities/ledger-tx.entity';
import { LedgerAccountRepository } from './repositories/ledger-account.repository';
import { LedgerLegRepository } from './repositories/ledger-leg.repository';
import { LedgerTxRepository } from './repositories/ledger-tx.repository';
import { BankTxConsumer } from './services/consumers/bank-tx.consumer';
import { BuyCryptoConsumer } from './services/consumers/buy-crypto.consumer';
import { BuyFiatConsumer } from './services/consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from './services/consumers/crypto-input.consumer';
import { ExchangeTxConsumer } from './services/consumers/exchange-tx.consumer';
import { LiquidityMgmtConsumer } from './services/consumers/liquidity-mgmt.consumer';
import { LiquidityOrderDexConsumer } from './services/consumers/liquidity-order-dex.consumer';
import { PayoutOrderConsumer } from './services/consumers/payout-order.consumer';
import { TradingOrderConsumer } from './services/consumers/trading-order.consumer';
import { LedgerAccountService } from './services/ledger-account.service';
import { LedgerBookingJobService } from './services/ledger-booking-job.service';
import { LedgerBookingService } from './services/ledger-booking.service';
import { LedgerBootstrapService } from './services/ledger-bootstrap.service';
import { LedgerCutoverService } from './services/ledger-cutover.service';
import { LedgerMarkService } from './services/ledger-mark.service';
import { LedgerMarkToMarketService } from './services/ledger-mark-to-market.service';
import { LedgerQueryService } from './services/ledger-query.service';
import { LedgerReconciliationService } from './services/ledger-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LedgerAccount,
      LedgerTx,
      LedgerLeg, // own (write targets)
      BankTx,
      ExchangeTx,
      PayoutOrder,
      CryptoInput, // source entities (read-only)
      BuyCrypto,
      BuyFiat,
      LiquidityManagementOrder,
      TradingOrder,
      LiquidityOrder, // dex (§4.8a)
      RefReward,
      Asset,
      Bank, // accountIban→bank.asset lookup for the BankTx consumer (§4.2/§1.6)
      BankTxReturn,
      BankTxRepeat, // chargeback → original BANK_TX_RETURN/REPEAT opening-CHF anchor (§4.2 B-15, read-only)
    ]),
    SharedModule, // AssetService (CoA §3.2), DataSource
    LogModule, // LogService.getFinancialLogs (mark preload §5.2)
    LiquidityManagementModule, // LiquidityManagementBalanceService.getBalances (feed read §7.0)
    NotificationModule, // NotificationService.sendMail (ledger alarms §7.3/§7.4/§7.5, Major R12-1)
  ],
  controllers: [LedgerController],
  providers: [
    LedgerAccountRepository,
    LedgerTxRepository,
    LedgerLegRepository,
    LedgerAccountService,
    LedgerBootstrapService,
    LedgerBookingService,
    LedgerMarkService,
    LedgerBookingJobService,
    LedgerCutoverService,
    LedgerMarkToMarketService,
    LedgerReconciliationService,
    LedgerQueryService,
    BankTxConsumer,
    ExchangeTxConsumer,
    CryptoInputConsumer,
    PayoutOrderConsumer,
    BuyCryptoConsumer,
    BuyFiatConsumer,
    LiquidityMgmtConsumer,
    LiquidityOrderDexConsumer,
    TradingOrderConsumer,
  ],
  exports: [],
})
export class AccountingModule {}
