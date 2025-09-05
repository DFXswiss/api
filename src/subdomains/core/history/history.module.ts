import { Module } from '@nestjs/common';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { StakingModule } from '../staking/staking.module';
import { TransactionUtilModule } from '../transaction/transaction-util.module';
import { HistoryController } from './controllers/history.controller';
import { TransactionController } from './controllers/transaction.controller';
import { HistoryService } from './services/history.service';

@Module({
  imports: [
    SharedModule,
    BuyCryptoModule,
    ReferralModule,
    SellCryptoModule,
    UserModule,
    BitcoinModule,
    StakingModule,
    TransactionModule,
    BankTxModule,
    PaymentModule,
    TransactionUtilModule,
    BankModule,
  ],
  controllers: [HistoryController, TransactionController],
  providers: [HistoryService, TransactionController],
  exports: [],
})
export class HistoryModule {}
