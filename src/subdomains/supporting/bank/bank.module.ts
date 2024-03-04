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
import { MultiAccountIban } from './multi-account-iban/multi-account-iban.entity';
import { MultiAccountIbanRepository } from './multi-account-iban/multi-account-iban.repository';
import { MultiAccountIbanService } from './multi-account-iban/multi-account-iban.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccount, Bank, MultiAccountIban]),
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
    MultiAccountIbanService,
    MultiAccountIbanRepository,
  ],
  exports: [BankAccountService, BankService, MultiAccountIbanService],
})
export class BankModule {}
