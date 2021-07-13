import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import config from './config/config';
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
import { AllController } from './all/all.controller';
import { UserService } from './user/user.service';
import { BuyService } from './buy/buy.service';
import { SellService } from './sell/sell.service';
import { AssetService } from './asset/asset.service';
import { FiatService } from './fiat/fiat.service';
import { WalletService } from './wallet/wallet.service';
import { DepositService } from './deposit/deposit.service';
import { CountryService } from './country/country.service';
import { AllService } from './all/all.service';
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

@Module({
  imports: [
    ConfigModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      // TODO: Secret to .env!!!
      // Notice that the same key is used in jwt.strategy.ts!
      secret: 'some-secret-key',
      signOptions: {
        expiresIn: 3600,
      }
    }),
    TypeOrmModule.forRoot({
      type: "mssql",
      host: process.env.SQL_HOST,
      port: Number.parseInt(process.env.SQL_PORT),
      username: process.env.SQL_USERNAME,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB,
      entities: ["dist/**/*.entity{.ts,.js}"],
      synchronize: (process.env.SQL_SYNCHRONIZE === 'true'),}
    ),
    TypeOrmModule.forFeature([UserRepository,AssetRepository,WalletRepository,DepositRepository,CountryRepository,FiatRepository,BuyRepository,SellRepository,]),
  ],
  controllers: [
    AppController,
    AuthController,
    UserController,
    AssetController,
    WalletController,
    DepositController,
    CountryController,
    FiatController,
    BuyController,
    SellController,
  ],
  providers: [
    UserService,
    AuthService,
    AssetService,
    WalletService,
    DepositService,
    CountryService,
    FiatService,
    BuyService,
    SellService,
    JwtStrategy
  ],
  exports: [
    UserService,
    AuthService,
    AssetService,
    WalletService,
    DepositService,
    CountryService,
    FiatService,
    BuyService,
    SellService,
    TypeOrmModule,
    JwtStrategy,
    PassportModule
  ],
})
export class AppModule {}
