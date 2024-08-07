import { forwardRef, Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { AmlService } from './aml.service';

@Module({
  imports: [forwardRef(() => UserModule), TransactionModule, BankModule, KycModule, SharedModule],
  controllers: [],
  providers: [AmlService],
  exports: [AmlService],
})
export class AmlModule {}
