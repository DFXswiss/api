import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankAccountAdminController } from './bank-account/bank-account-admin.controller';
import { BankAccountController } from './bank-account/bank-account.controller';
import { BankAccount } from './bank-account/bank-account.entity';
import { BankAccountRepository } from './bank-account/bank-account.repository';
import { BankAccountService } from './bank-account/bank-account.service';
import { Bank } from './bank/bank.entity';
import { BankRepository } from './bank/bank.repository';
import { BankService } from './bank/bank.service';
import { SpecialExternalBankAccount } from './special-external-bank-account/special-external-bank-account.entity';
import { SpecialExternalBankAccountRepository } from './special-external-bank-account/special-external-bank-account.repository';
import { SpecialExternalBankAccountService } from './special-external-bank-account/special-external-bank-account.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccount, Bank, SpecialExternalBankAccount]),
    SharedModule,
    BankIntegrationModule,
    forwardRef(() => UserModule),
  ],

  controllers: [BankAccountController, BankAccountAdminController],
  providers: [
    BankAccountRepository,
    BankRepository,
    BankAccountService,
    BankService,
    SpecialExternalBankAccountService,
    SpecialExternalBankAccountRepository,
  ],
  exports: [BankAccountService, BankService, SpecialExternalBankAccountService],
})
export class BankModule {}
