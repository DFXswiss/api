import { Module } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { ExchangeModule } from 'src/integration/exchange/exchange.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { PaymentLinkPaymentModule } from 'src/subdomains/core/payment-link/payment-link-payment.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { TradingModule } from 'src/subdomains/core/trading/trading.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { BankModule } from '../bank/bank.module';
import { PayInModule } from '../payin/payin.module';
import { PayoutModule } from '../payout/payout.module';
import { LogJobService } from './log-job.service';
import { LogModule } from './log.module';

@Module({
  imports: [
    SharedModule,
    TradingModule,
    LiquidityManagementModule,
    LogModule,
    PayInModule,
    SellCryptoModule,
    BuyCryptoModule,
    BankTxModule,
    ExchangeModule,
    BankModule,
    BlockchainModule,
    ReferralModule,
    PayoutModule,
    PaymentLinkPaymentModule,
  ],
  controllers: [],
  providers: [LogJobService],
  exports: [],
})
export class LogJobModule {}
