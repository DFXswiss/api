import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { Sanction } from './entities/sanction.entity';
import { SanctionRepository } from './repositories/sanction.repository';
import { AmlService } from './services/aml.service';
import { SanctionService } from './services/sanction.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sanction]),
    forwardRef(() => UserModule),
    forwardRef(() => TransactionModule),
    BankModule,
    forwardRef(() => KycModule),
    SharedModule,
    forwardRef(() => PayInModule),
  ],
  controllers: [],
  providers: [AmlService, SanctionService, SanctionRepository],
  exports: [AmlService],
})
export class AmlModule {}
