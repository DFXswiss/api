import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { UserController } from './user/user.controller';
import { BuyController } from './buy/buy.controller';
import { SellController } from './sell/sell.controller';
import { AssetController } from './asset/asset.controller';
import { FiatController } from './fiat/fiat.controller';
import { WalletController } from './wallet/wallet.controller';
import { DepositController } from './deposit/deposit.controller';
import { CountryController } from './country/country.controller';
import { AuthController } from './auth/auth.controller';
import { AllDataController } from './all/all.controller';
import { UserService } from './user/user.service';
import { BuyService } from './buy/buy.service';
import { SellService } from './sell/sell.service';
import { AssetService } from './asset/asset.service';
import { FiatService } from './fiat/fiat.service';
import { WalletService } from './wallet/wallet.service';
import { DepositService } from './deposit/deposit.service';
import { CountryService } from './country/country.service';
import { AllDataService } from './all/all.service';
import { AuthService } from './auth/auth.service';
import { UserRepository } from './user/user.repository';
import { AssetRepository } from './asset/asset.repository';
import { WalletRepository } from './wallet/wallet.repository';
import { DepositRepository } from './deposit/deposit.repository';
import { CountryRepository } from './country/country.repository';
import { FiatRepository } from './fiat/fiat.repository';
import { BuyRepository } from './buy/buy.repository';
import { SellRepository } from './sell/sell.repository';
import { JwtStrategy } from './auth/jwt.strategy';
import { StatisticController } from './statistic/statistic.controller';
import { StatisticService } from './statistic/statistic.service';
import { LogController } from './log/log.controller';
import { LogService } from './log/log.service';
import { HealthController } from './health/health.controller';
import { LogRepository } from './log/log.repository';
import { PaymentRepository } from './payment/payment.repository';
import { PaymentController } from './payment/payment.controller';
import { PaymentService } from './payment/payment.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt', session: true }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: 172800,
      },
    }),
    TypeOrmModule.forRoot({
      type: 'mssql',
      host: process.env.SQL_HOST,
      port: Number.parseInt(process.env.SQL_PORT),
      username: process.env.SQL_USERNAME,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB,
      entities: ['dist/**/*.entity{.ts,.js}'],
      synchronize: process.env.SQL_SYNCHRONIZE === 'true',
      migrationsRun: process.env.SQL_MIGRATE === 'true',
      migrations: ['migration/*.js'],
      cli: {
        migrationsDir: 'migration',
      },
    }),
    TypeOrmModule.forFeature([
      UserRepository,
      BuyRepository,
      SellRepository,
      LogRepository,
      AssetRepository,
      WalletRepository,
      DepositRepository,
      CountryRepository,
      FiatRepository,
      PaymentRepository,
    ]),
  ],
  controllers: [
    AppController,
    AuthController,
    UserController,
    BuyController,
    SellController,
    LogController,
    AssetController,
    WalletController,
    DepositController,
    CountryController,
    FiatController,
    StatisticController,
    HealthController,
    PaymentController,
    AllDataController,
  ],
  providers: [
    UserService,
    AuthService,
    BuyService,
    SellService,
    LogService,
    AssetService,
    WalletService,
    DepositService,
    CountryService,
    FiatService,
    JwtStrategy,
    StatisticService,
    PaymentService,
    AllDataService,
  ],
  exports: [
    UserService,
    AuthService,
    BuyService,
    SellService,
    LogService,
    AssetService,
    WalletService,
    DepositService,
    CountryService,
    FiatService,
    TypeOrmModule,
    JwtStrategy,
    PassportModule,
    StatisticService,
    PaymentService,
    AllDataService,
  ],
})
export class AppModule {}
