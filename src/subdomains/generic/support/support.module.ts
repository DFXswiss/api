import { Module, forwardRef } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { KycModule } from '../kyc/kyc.module';
import { UserModule } from '../user/user.module';
import { SupportController } from './support.controller';
import { SupportPdfService } from './support-pdf.service';
import { SupportService } from './support.service';

@Module({
  imports: [
    SharedModule,
    UserModule,
    BuyCryptoModule,
    SellCryptoModule,
    PayInModule,
    BankModule,
    BankTxModule,
    KycModule,
    TransactionModule,
    SupportIssueModule,
    forwardRef(() => PaymentModule),
  ],
  controllers: [SupportController],
  providers: [SupportService, SupportPdfService],
  exports: [],
})
export class SupportModule {}
