import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SharedModule } from '../../../shared/shared.module';
import { FeeController } from './controllers/fee.controller';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { FeeRepository } from './repositories/fee.repository';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { FeeService } from './services/fee.service';
import { TransactionHelper } from './services/transaction-helper';

@Module({
  imports: [
    PricingModule,
    SharedModule,
    TypeOrmModule.forFeature([TransactionSpecification]),
    forwardRef(() => UserModule),
  ],
  controllers: [FeeController],
  providers: [TransactionHelper, TransactionSpecificationRepository, FeeService, FeeRepository],
  exports: [TransactionHelper, FeeService],
})
export class PaymentModule {}
