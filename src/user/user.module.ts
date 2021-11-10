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
import { AllDataController } from './models/all/all.controller';
import { AllDataService } from './models/all/all.service';
import { AuthController } from './models/auth/auth.controller';
import { AuthService } from './models/auth/auth.service';
import { BankDataRepository } from './models/bankData/bankData.repository';
import { BankDataService } from './models/bankData/bankData.service';
import { BuyController } from './models/buy/buy.controller';
import { BuyRepository } from './models/buy/buy.repository';
import { BuyService } from './models/buy/buy.service';
import { DepositController } from './models/deposit/deposit.controller';
import { DepositRepository } from './models/deposit/deposit.repository';
import { DepositService } from './models/deposit/deposit.service';
import { LogController } from './models/log/log.controller';
import { LogRepository } from './models/log/log.repository';
import { LogService } from './models/log/log.service';
import { RefController } from './models/referral/ref.controller';
import { RefRepository } from './models/referral/ref.repository';
import { RefService } from './models/referral/ref.service';
import { SellController } from './models/sell/sell.controller';
import { SellRepository } from './models/sell/sell.repository';
import { SellService } from './models/sell/sell.service';
import { UserController } from './models/user/user.controller';
import { UserRepository } from './models/user/user.repository';
import { UserService } from './models/user/user.service';
import { KycFile } from './models/userData/kycFile.entity';
import { KycApiService } from './services/kyc/kyc.api.service';
import { KycSchedulerService } from './services/kyc/kyc.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRepository,
      UserDataRepository,
      BuyRepository,
      SellRepository,
      LogRepository,
      WalletRepository,
      DepositRepository,
      BankDataRepository,
      RefRepository,
      KycFile,
    ]),
    SharedModule,
    AinModule,
  ],
  controllers: [
    UserController,
    BuyController,
    SellController,
    LogController,
    WalletController,
    DepositController,
    UserDataController,
    RefController,
    AllDataController,
    AuthController,
  ],
  providers: [
    UserService,
    BuyService,
    SellService,
    LogService,
    WalletService,
    DepositService,
    UserDataService,
    BankDataService,
    RefService,
    AllDataService,
    KycSchedulerService,
    KycApiService,
    AuthService,
  ],
  exports: [BuyService, SellService, LogService, KycSchedulerService, KycApiService, RefService],
})
export class UserModule {}
