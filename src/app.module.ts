import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { User } from './user/user.entity'
import { Asset } from './asset/asset.entity'
import { Buy } from './buy/buy.entity'
import { Sell } from './sell/sell.entity'
import { Country } from './country/country.entity'
import { Fiat } from './fiat/fiat.entity'
import { Deposit } from './deposit/deposit.entity'
import { Wallet } from './wallet/wallet.entity'


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config],
    }),
    TypeOrmModule.forRoot(),
    TypeOrmModule.forFeature([User,Buy,Sell,Asset,Country,Fiat,Deposit,Wallet])],
  controllers: [
    AppController,
    AuthController,
    UserController,
    BuyController,
    SellController,
    AssetController,
    FiatController,
    WalletController,
    DepositController,
    CountryController,
    AllController,
  ],
  providers: [
    UserService,
    AuthService,
    BuyService,
    SellService,
    AssetService,
    FiatService,
    WalletService,
    DepositService,
    CountryService,
    AllService,
  ],
  exports: [
    UserService,
    AuthService,
    BuyService,
    SellService,
    AssetService,
    FiatService,
    WalletService,
    DepositService,
    CountryService,
    AllService,
    TypeOrmModule
  ],
})
export class AppModule {}
