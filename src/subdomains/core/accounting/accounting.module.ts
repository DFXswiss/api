import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { AccountingController } from './controllers/accounting.controller';
import { AccountingService } from './services/accounting.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([Bank, BankTx])],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [],
})
export class AccountingModule {}
