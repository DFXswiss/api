import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SharedModule } from '../../../shared/shared.module';
import { PayoutModule } from '../payout/payout.module';
import { FeeController } from './controllers/fee.controller';
import { BlockchainFee } from './entities/blockchain-fee.entity';
import { Fee } from './entities/fee.entity';
import { TransactionRequest } from './entities/transaction-request.entity';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { BlockchainFeeRepository } from './repositories/blockchain-fee.repository';
import { FeeRepository } from './repositories/fee.repository';
import { SpecialExternalAccountRepository } from './repositories/special-external-account.repository';
import { TransactionRequestRepository } from './repositories/transaction-request.repository';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { FeeService } from './services/fee.service';
import { SpecialExternalAccountService } from './services/special-external-account.service';
import { TransactionHelper } from './services/transaction-helper';
import { TransactionRequestService } from './services/transaction-request.service';
import { TransactionJobModule } from './transaction-job.module';
import { TransactionModule } from './transaction.module';

@Module({
  imports: [
    PricingModule,
    SharedModule,
    PayoutModule,
    TypeOrmModule.forFeature([TransactionSpecification, Fee, TransactionRequest, BlockchainFee]),
    forwardRef(() => UserModule),
    forwardRef(() => SellCryptoModule),
    forwardRef(() => BuyCryptoModule),
    TransactionJobModule,
    TransactionModule,
  ],
  controllers: [FeeController],
  providers: [
    TransactionHelper,
    TransactionSpecificationRepository,
    FeeService,
    FeeRepository,
    TransactionRequestRepository,
    BlockchainFeeRepository,
    TransactionRequestService,
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
  ],
  exports: [TransactionHelper, FeeService, TransactionRequestService, SpecialExternalAccountService],
})
export class PaymentModule {}
