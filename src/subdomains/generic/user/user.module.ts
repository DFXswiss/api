import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { UserDataController } from 'src/subdomains/generic/user/models/user-data/user-data.controller';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { KycModule } from '../kyc/kyc.module';
import { AccountMerge } from './models/account-merge/account-merge.entity';
import { AccountMergeRepository } from './models/account-merge/account-merge.repository';
import { AccountMergeService } from './models/account-merge/account-merge.service';
import { AuthAlbyService } from './models/auth/auth-alby.service';
import { AuthLnurlController } from './models/auth/auth-lnurl.controller';
import { AuthLnUrlService } from './models/auth/auth-lnurl.service';
import { AuthController } from './models/auth/auth.controller';
import { AuthService } from './models/auth/auth.service';
import { BankDataController } from './models/bank-data/bank-data.controller';
import { BankData } from './models/bank-data/bank-data.entity';
import { BankDataRepository } from './models/bank-data/bank-data.repository';
import { BankDataService } from './models/bank-data/bank-data.service';
import { KycClientController, KycController } from './models/kyc/kyc.controller';
import { KycService } from './models/kyc/kyc.service';
import { MultiAccountIban } from './models/multi-account-iban/multi-account-iban.entity';
import { MultiAccountIbanRepository } from './models/multi-account-iban/multi-account-iban.repository';
import { MultiAccountIbanService } from './models/multi-account-iban/multi-account-iban.service';
import { UserDataRelationController } from './models/user-data-relation/user-data-relation.controller';
import { UserDataRelationRepository } from './models/user-data-relation/user-data-relation.repository';
import { UserDataRelationService } from './models/user-data-relation/user-data-relation.service';
import { UserDataNotificationService } from './models/user-data/user-data-notification.service';
import { UserData } from './models/user-data/user-data.entity';
import { UserController } from './models/user/user.controller';
import { User } from './models/user/user.entity';
import { UserRepository } from './models/user/user.repository';
import { UserService } from './models/user/user.service';
import { Wallet } from './models/wallet/wallet.entity';
import { WebhookNotificationService } from './services/webhook/webhook-notification.service';
import { Webhook } from './services/webhook/webhook.entity';
import { WebhookRepository } from './services/webhook/webhook.repository';
import { WebhookService } from './services/webhook/webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserData, Wallet, BankData, AccountMerge, Webhook, MultiAccountIban]),
    SharedModule,
    NotificationModule,
    BlockchainModule,
    ReferralModule,
    KycModule,
    forwardRef(() => PaymentModule),
    forwardRef(() => KycModule),
  ],
  controllers: [
    UserController,
    UserDataController,
    BankDataController,
    AuthController,
    AuthLnurlController,
    KycClientController,
    KycController,
    UserDataRelationController,
  ],
  providers: [
    UserRepository,
    UserDataRepository,
    WalletRepository,
    BankDataRepository,
    UserDataRelationRepository,
    AccountMergeRepository,
    UserService,
    WalletService,
    UserDataService,
    BankDataService,
    AuthService,
    AuthAlbyService,
    AuthLnUrlService,
    WebhookRepository,
    WebhookService,
    WebhookNotificationService,
    KycService,
    UserDataNotificationService,
    UserDataRelationService,
    AccountMergeService,
    MultiAccountIbanRepository,
    MultiAccountIbanService,
  ],
  exports: [UserService, UserDataService, WebhookService, BankDataService, WalletService, MultiAccountIbanService],
})
export class UserModule {}
