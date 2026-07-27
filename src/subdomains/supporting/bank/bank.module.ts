import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { TransactionModule } from '../payment/transaction.module';
import { BankAccountController } from './bank-account/bank-account.controller';
import { BankAccount } from './bank-account/bank-account.entity';
import { BankAccountRepository } from './bank-account/bank-account.repository';
import { BankAccountService } from './bank-account/bank-account.service';
import { IsDfxIbanValidator } from './bank-account/is-dfx-iban.validator';
import { BankController } from './bank/bank.controller';
import { Bank } from './bank/bank.entity';
import { BankRepository } from './bank/bank.repository';
import { BankService } from './bank/bank.service';
import { FrickVibanProvider } from './virtual-iban/providers/frick-viban.provider';
import { YapealVibanProvider } from './virtual-iban/providers/yapeal-viban.provider';
import { VirtualIbanFrickIssuanceReconciliationService } from './virtual-iban/virtual-iban-frick-issuance-reconciliation.service';
import { VirtualIbanIssuanceEvent } from './virtual-iban/virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntent } from './virtual-iban/virtual-iban-issuance-intent.entity';
import { VirtualIbanLifecycleEvent } from './virtual-iban/virtual-iban-lifecycle-event.entity';
import { VirtualIban } from './virtual-iban/virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban/virtual-iban.repository';
import { VirtualIbanService } from './virtual-iban/virtual-iban.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankAccount,
      Bank,
      VirtualIban,
      VirtualIbanIssuanceIntent,
      VirtualIbanIssuanceEvent,
      VirtualIbanLifecycleEvent,
    ]),
    SharedModule,
    BankIntegrationModule,
    NotificationModule,
    forwardRef(() => UserModule),
    forwardRef(() => TransactionModule),
  ],

  controllers: [BankController, BankAccountController],
  providers: [
    BankAccountRepository,
    BankRepository,
    VirtualIbanRepository,
    BankAccountService,
    BankService,
    FrickVibanProvider,
    YapealVibanProvider,
    VirtualIbanService,
    VirtualIbanFrickIssuanceReconciliationService,
    IsDfxIbanValidator,
  ],
  exports: [BankAccountService, BankService, VirtualIbanService],
})
export class BankModule {}
