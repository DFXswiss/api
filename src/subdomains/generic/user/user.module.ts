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
import { TotpAuthLogRepository } from '../kyc/repositories/totp-auth-log.repository';
import { AuthAlbyService } from './models/auth/auth-alby.service';
import { AuthLnurlController } from './models/auth/auth-lnurl.controller';
import { AuthLnUrlService } from './models/auth/auth-lnurl.service';
import { AuthTotpService } from './models/auth/auth-totp.service';
import { AuthController } from './models/auth/auth.controller';
import { AuthService } from './models/auth/auth.service';
import { BankDataController } from './models/bank-data/bank-data.controller';
import { BankData } from './models/bank-data/bank-data.entity';
import { BankDataRepository } from './models/bank-data/bank-data.repository';
import { BankDataService } from './models/bank-data/bank-data.service';
import { KycClientController, KycController } from './models/kyc/kyc.controller';
import { KycService } from './models/kyc/kyc.service';
import { LimitRequestNotificationService } from './models/limit-request/limit-request-notification.service';
import { LimitRequestController } from './models/limit-request/limit-request.controller';
import { LimitRequest } from './models/limit-request/limit-request.entity';
import { LimitRequestRepository } from './models/limit-request/limit-request.repository';
import { LimitRequestService } from './models/limit-request/limit-request.service';
import { LinkAddress } from './models/link/link-address.entity';
import { LinkAddressRepository } from './models/link/link-address.repository';
import { LinkController } from './models/link/link.controller';
import { LinkService } from './models/link/link.service';
import { SpiderData } from './models/spider-data/spider-data.entity';
import { SpiderDataRepository } from './models/spider-data/spider-data.repository';
import { UserDataNotificationService } from './models/user-data/user-data-notification.service';
import { UserData } from './models/user-data/user-data.entity';
import { UserController } from './models/user/user.controller';
import { User } from './models/user/user.entity';
import { UserRepository } from './models/user/user.repository';
import { UserService } from './models/user/user.service';
import { WalletController } from './models/wallet/wallet.controller';
import { Wallet } from './models/wallet/wallet.entity';
import { WebhookService } from './services/webhook/webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserData, SpiderData, Wallet, BankData, LimitRequest, LinkAddress]),
    SharedModule,
    NotificationModule,
    BlockchainModule,
    ReferralModule,
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
    LinkController,
    LimitRequestController,
    WalletController,
  ],
  providers: [
    UserRepository,
    UserDataRepository,
    TotpAuthLogRepository,
    SpiderDataRepository,
    WalletRepository,
    BankDataRepository,
    LimitRequestRepository,
    LinkAddressRepository,
    UserService,
    WalletService,
    UserDataService,
    BankDataService,
    AuthService,
    AuthAlbyService,
    AuthLnUrlService,
    AuthTotpService,
    LimitRequestService,
    LinkService,
    WebhookService,
    KycService,
    LimitRequestNotificationService,
    UserDataNotificationService,
  ],
  exports: [UserService, UserDataService, LinkService, WebhookService, BankDataService],
})
export class UserModule {}
