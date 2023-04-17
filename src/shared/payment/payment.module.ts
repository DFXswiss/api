import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { TransactionSpecificationService } from './services/transaction-specification.service';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionSpecification])],
  providers: [TransactionSpecificationService, TransactionSpecificationRepository],
  exports: [TransactionSpecificationService],
})
export class PaymentModule {}
