import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserDataController } from 'src/user/models/user-data/user-data.controller';
import { UserDataRepository } from 'src/user/models/user-data/user-data.repository';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { WalletService } from 'src/user/models/wallet/wallet.service';
import { AuthController } from './models/auth/auth.controller';
import { AuthService } from './models/auth/auth.service';
import { BankDataController } from './models/bank-data/bank-data.controller';
import { BankDataRepository } from './models/bank-data/bank-data.repository';
import { BankDataService } from './models/bank-data/bank-data.service';
import { SpiderDataRepository } from './models/spider-data/spider-data.repository';
import { RefController } from './models/referral/ref.controller';
import { RefRepository } from './models/referral/ref.repository';
import { RefService } from './models/referral/ref.service';
import { UserController } from './models/user/user.controller';
import { UserRepository } from './models/user/user.repository';
import { UserService } from './models/user/user.service';
import { SpiderApiService } from './services/spider/spider-api.service';
import { SpiderSyncService } from './services/spider/spider-sync.service';
import { KycService } from './models/kyc/kyc.service';
import { LimitRequestRepository } from './models/limit-request/limit-request.repository';
import { LimitRequestService } from './models/limit-request/limit-request.service';
import { IdentController } from './models/ident/ident.controller';
import { IdentService } from './models/ident/ident.service';
import { SpiderService } from './services/spider/spider.service';
import { KycProcessService } from './models/kyc/kyc-process.service';
import { KycController } from './models/kyc/kyc.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRepository,
      UserDataRepository,
      SpiderDataRepository,
      WalletRepository,
      BankDataRepository,
      RefRepository,
      LimitRequestRepository,
    ]),
    SharedModule,
    AinModule,
  ],
  controllers: [
    UserController,
    UserDataController,
    BankDataController,
    RefController,
    AuthController,
    IdentController,
    KycController,
  ],
  providers: [
    UserService,
    WalletService,
    UserDataService,
    BankDataService,
    RefService,
    KycService,
    KycProcessService,
    SpiderService,
    SpiderApiService,
    SpiderSyncService,
    AuthService,
    LimitRequestService,
    IdentService,
  ],
  exports: [UserService, UserDataService, RefService, KycService, SpiderService, SpiderApiService],
})
export class UserModule {}
