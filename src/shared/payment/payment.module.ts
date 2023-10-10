import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SharedModule } from '../shared.module';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { TransactionHelper } from './services/transaction-helper';
import { FeeModule } from 'src/subdomains/core/fee/fee.module';

@Module({
  imports: [PricingModule, SharedModule, TypeOrmModule.forFeature([TransactionSpecification]), FeeModule],
  providers: [TransactionHelper, TransactionSpecificationRepository],
  exports: [TransactionHelper],
})
export class PaymentModule {}
