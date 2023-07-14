import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SharedModule } from '../shared.module';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { TransactionHelper } from './services/transaction-helper';

@Module({
  imports: [PricingModule, SharedModule, TypeOrmModule.forFeature([TransactionSpecification])],
  providers: [TransactionHelper, TransactionSpecificationRepository],
  exports: [TransactionHelper, TransactionSpecificationRepository],
})
export class PaymentModule {}
