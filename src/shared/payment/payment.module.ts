import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionSpecificationController } from './api/transaction-specification.controller';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { TransactionSpecificationService } from './services/transaction-specification.service';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionSpecification])],
  controllers: [TransactionSpecificationController],
  providers: [TransactionSpecificationService],
  exports: [],
})
export class PaymentModule {}
