import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserDataController } from 'src/user/models/userData/userData.controller';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { WalletController } from 'src/user/models/wallet/wallet.controller';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { WalletService } from 'src/user/models/wallet/wallet.service';
import { AuthController } from './models/auth/auth.controller';
import { AuthService } from './models/auth/auth.service';
import { BankDataController } from './models/bank-data/bank-data.controller';
import { BankDataRepository } from './models/bank-data/bank-data.repository';
import { BankDataService } from './models/bank-data/bank-data.service';
import { SpiderDataRepository } from './models/spider-data/spider-data.repository';
import { LogController } from './models/log/log.controller';
import { LogRepository } from './models/log/log.repository';
import { LogService } from './models/log/log.service';
import { RefController } from './models/referral/ref.controller';
import { RefRepository } from './models/referral/ref.repository';
import { RefService } from './models/referral/ref.service';
import { UserController } from './models/user/user.controller';
import { UserRepository } from './models/user/user.repository';
import { UserService } from './models/user/user.service';
import { KycApiService } from './services/kyc/kyc-api.service';
import { KycSchedulerService } from './services/kyc/kyc-scheduler.service';
import { KycService } from './services/kyc/kyc.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRepository,
      UserDataRepository,
      SpiderDataRepository,
      LogRepository,
      WalletRepository,
      BankDataRepository,
      RefRepository,
    ]),
    SharedModule,
    AinModule,
  ],
  controllers: [
    UserController,
    LogController,
    WalletController,
    UserDataController,
    BankDataController,
    RefController,
    AuthController,
  ],
  providers: [
    UserService,
    LogService,
    WalletService,
    UserDataService,
    BankDataService,
    RefService,
    KycService,
    KycApiService,
    KycSchedulerService,
    AuthService,
  ],
  exports: [UserService, UserDataService, LogService, RefService],
})
export class UserModule {}
