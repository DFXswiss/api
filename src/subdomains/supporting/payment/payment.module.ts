import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SiftModule } from 'src/integration/sift/sift.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SharedModule } from '../../../shared/shared.module';
import { BankModule } from '../bank/bank.module';
import { PayoutModule } from '../payout/payout.module';
import { FeeController } from './controllers/fee.controller';
import { SpecialExternalAccountController } from './controllers/special-external-account.controller';
import { BlockchainFee } from './entities/blockchain-fee.entity';
import { Fee } from './entities/fee.entity';
import { TransactionRequest } from './entities/transaction-request.entity';
import { TransactionSpecification } from './entities/transaction-specification.entity';
import { BlockchainFeeRepository } from './repositories/blockchain-fee.repository';
import { FeeRepository } from './repositories/fee.repository';
import { SpecialCodeRepository } from './repositories/special-code.repository';
import { SpecialExternalAccountRepository } from './repositories/special-external-account.repository';
import { TransactionRequestRepository } from './repositories/transaction-request.repository';
import { TransactionSpecificationRepository } from './repositories/transaction-specification.repository';
import { FeeService } from './services/fee.service';
import { SpecialCodeService } from './services/special-code.service';
import { SpecialExternalAccountService } from './services/special-external-account.service';
import { SwissQRService } from './services/swiss-qr.service';
import { TransactionHelper } from './services/transaction-helper';
import { TransactionRequestService } from './services/transaction-request.service';
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
    TransactionModule,
    SiftModule,
    BlockchainModule,
    BankModule,
  ],
  controllers: [FeeController, SpecialExternalAccountController],
  providers: [
    TransactionHelper,
    TransactionSpecificationRepository,
    FeeService,
    SwissQRService,
    FeeRepository,
    TransactionRequestRepository,
    BlockchainFeeRepository,
    TransactionRequestService,
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
    SpecialCodeRepository,
    SpecialCodeService,
  ],
  exports: [
    TransactionHelper,
    FeeService,
    SwissQRService,
    TransactionRequestService,
    SpecialExternalAccountService,
    SpecialCodeService,
  ],
})
export class PaymentModule {}
