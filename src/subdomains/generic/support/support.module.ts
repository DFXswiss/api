import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { RecallModule } from 'src/subdomains/supporting/recall/recall.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { KycModule } from '../kyc/kyc.module';
import { UserModule } from '../user/user.module';
import { SupportNote } from './entities/support-note.entity';
import { SupportNoteRepository } from './repositories/support-note.repository';
import { SupportNoteService } from './services/support-note.service';
import { SupportController } from './support.controller';
import { SupportPdfService } from './support-pdf.service';
import { SupportService } from './support.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportNote]),
    SharedModule,
    UserModule,
    BuyCryptoModule,
    SellCryptoModule,
    ReferralModule,
    PayInModule,
    BankModule,
    BankTxModule,
    KycModule,
    TransactionModule,
    SupportIssueModule,
    RecallModule,
    NotificationModule,
    forwardRef(() => PaymentModule),
  ],
  controllers: [SupportController],
  providers: [SupportService, SupportPdfService, SupportNoteService, SupportNoteRepository],
  exports: [],
})
export class SupportModule {}
