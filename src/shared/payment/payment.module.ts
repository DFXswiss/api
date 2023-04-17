import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionSpecificationController } from './api/transaction-specification.controller';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { TransactionSpecificationService } from './services/transaction-specification.service';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionSpecification])],
  controllers: [TransactionSpecificationController],
  providers: [TransactionSpecificationService, TransactionSpecificationRepository],
  exports: [],
})
export class PaymentModule {}
