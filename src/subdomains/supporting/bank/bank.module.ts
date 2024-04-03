import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { TransactionModule } from '../payment/transaction.module';
import { BankAccountAdminController } from './bank-account/bank-account-admin.controller';
import { BankAccountController } from './bank-account/bank-account.controller';
import { BankAccount } from './bank-account/bank-account.entity';
import { BankAccountRepository } from './bank-account/bank-account.repository';
import { BankAccountService } from './bank-account/bank-account.service';
import { IsDfxIbanValidator } from './bank-account/is-dfx-iban.validator';
import { Bank } from './bank/bank.entity';
import { BankRepository } from './bank/bank.repository';
import { BankService } from './bank/bank.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccount, Bank]),
    SharedModule,
    BankIntegrationModule,
    forwardRef(() => UserModule),
    TransactionModule,
  ],

  controllers: [BankAccountController, BankAccountAdminController],
  providers: [BankAccountRepository, BankRepository, BankAccountService, BankService, IsDfxIbanValidator],
  exports: [BankAccountService, BankService],
})
export class BankModule {}
