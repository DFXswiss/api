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
import { SpecialExternalAccount } from './special-external-account/special-external-account.entity';
import { SpecialExternalAccountRepository } from './special-external-account/special-external-account.repository';
import { SpecialExternalAccountService } from './special-external-account/special-external-account.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccount, Bank, SpecialExternalAccount]),
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
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
  ],
  exports: [BankAccountService, BankService, SpecialExternalAccountService],
})
export class BankModule {}
