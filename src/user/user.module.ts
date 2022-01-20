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
import { BuyController } from './models/buy/buy.controller';
import { BuyRepository } from './models/buy/buy.repository';
import { BuyService } from './models/buy/buy.service';
import { SpiderDataRepository } from './models/spider-data/spider-data.repository';
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
import { KycApiService } from './services/kyc/kyc-api.service';
import { KycSchedulerService } from './services/kyc/kyc-scheduler.service';
import { StakingRepository } from './models/staking/staking.repository';
import { StakingController } from './models/staking/staking.controller';
import { StakingService } from './models/staking/staking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRepository,
      UserDataRepository,
      SpiderDataRepository,
      BuyRepository,
      SellRepository,
      StakingRepository,
      LogRepository,
      WalletRepository,
      DepositRepository,
      BankDataRepository,
      RefRepository,
    ]),
    SharedModule,
    AinModule,
  ],
  controllers: [
    UserController,
    BuyController,
    SellController,
    StakingController,
    LogController,
    WalletController,
    DepositController,
    UserDataController,
    BankDataController,
    RefController,
    AuthController,
  ],
  providers: [
    UserService,
    BuyService,
    SellService,
    StakingService,
    LogService,
    WalletService,
    DepositService,
    UserDataService,
    BankDataService,
    RefService,
    KycSchedulerService,
    KycApiService,
    AuthService,
  ],
  exports: [
    UserService,
    BuyService,
    SellService,
    StakingService,
    LogService,
    KycSchedulerService,
    KycApiService,
    RefService,
  ],
})
export class UserModule {}
