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
import { TransactionRequestRepository } from './repositories/transaction-request.repository';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { FeeService } from './services/fee.service';
import { TransactionHelper } from './services/transaction-helper';
import { TransactionRequestService } from './services/transaction-request.service';

@Module({
  imports: [
    PricingModule,
    SharedModule,
    PayoutModule,
    TypeOrmModule.forFeature([TransactionSpecification, Fee, TransactionRequest, BlockchainFee]),
    forwardRef(() => UserModule),
    forwardRef(() => SellCryptoModule),
    forwardRef(() => BuyCryptoModule),
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
  ],
  exports: [TransactionHelper, FeeService, TransactionRequestService],
})
export class PaymentModule {}
