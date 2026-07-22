import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EthereumModule } from 'src/integration/blockchain/ethereum/ethereum.module';
import { RealUnitBlockchainModule } from 'src/integration/blockchain/realunit/realunit-blockchain.module';
import { SepoliaModule } from 'src/integration/blockchain/sepolia/sepolia.module';
import { Eip7702DelegationModule } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { FaucetRequestModule } from 'src/subdomains/core/faucet-request/faucet-request.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { BalanceModule } from '../balance/balance.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { BankModule } from '../bank/bank.module';
import { PaymentModule } from '../payment/payment.module';
import { TransactionModule } from '../payment/transaction.module';
import { PricingModule } from '../pricing/pricing.module';
import { RealUnitComplianceController } from './controllers/realunit-compliance.controller';
import { RealUnitLegalController } from './controllers/realunit-legal.controller';
import { RealUnitSupportController } from './controllers/realunit-support.controller';
import { RealUnitController } from './controllers/realunit.controller';
import { AktionariatRegistration } from './entities/aktionariat-registration.entity';
import { RealUnitLegalAcceptance } from './entities/realunit-legal-acceptance.entity';
import { RealUnitTransferRequest } from './entities/realunit-transfer-request.entity';
import { RealUnitComplianceService } from './realunit-compliance.service';
import { RealUnitDevService } from './realunit-dev.service';
import { RealUnitJobService } from './realunit-job.service';
import { RealUnitLegalService } from './realunit-legal.service';
import { RealUnitScopeService } from './realunit-scope.service';
import { RealUnitService } from './realunit.service';
import { AktionariatRegistrationRepository } from './repositories/aktionariat-registration.repository';
import { RealUnitLegalAcceptanceRepository } from './repositories/realunit-legal-acceptance.repository';
import { RealUnitTransferRequestRepository } from './repositories/realunit-transfer-request.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([AktionariatRegistration, RealUnitLegalAcceptance, RealUnitTransferRequest]),
    SharedModule,
    LogModule,
    PricingModule,
    BalanceModule,
    RealUnitBlockchainModule,
    EthereumModule,
    SepoliaModule,
    UserModule,
    KycModule,
    BankModule,
    BankTxModule,
    PaymentModule,
    TransactionModule,
    Eip7702DelegationModule,
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => SellCryptoModule),
    FaucetRequestModule,
    SupportIssueModule,
  ],
  controllers: [RealUnitController, RealUnitSupportController, RealUnitComplianceController, RealUnitLegalController],
  providers: [
    RealUnitService,
    RealUnitDevService,
    RealUnitJobService,
    RealUnitScopeService,
    RealUnitComplianceService,
    RealUnitLegalService,
    AktionariatRegistrationRepository,
    RealUnitLegalAcceptanceRepository,
    RealUnitTransferRequestRepository,
  ],
  exports: [RealUnitService, RealUnitScopeService],
})
export class RealUnitModule {}
