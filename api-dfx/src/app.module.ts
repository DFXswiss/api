import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm';
import config from './config/config';
import { TypeOrmConfig } from './config/typeorm.config';
import { AppController } from './app.controller';
import { UserController } from './wallet/user/user.controller';
import { BuyController } from './buy/buy.controller';
import { SellController } from './sell/sell.controller';
import { AssetController } from './asset/asset.controller';
import { FiatController } from './fiat/fiat.controller';
import { WalletController } from './wallet/wallet.controller';
import { DepositController } from './deposit/deposit.controller';
import { CountryController } from './country/country.controller';
import { UserService } from './wallet/user/user.service';
import { BuyService } from './buy/buy.service';
import { SellService } from './sell/sell.service';
import { AssetService } from './asset/asset.service';
import { FiatService } from './fiat/fiat.service';
import { WalletService } from './wallet/wallet.service';
import { DepositService } from './deposit/deposit.service';
import { CountryService } from './country/country.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config],
    }),
  ],
  controllers: [AppController, UserController, BuyController,SellController,AssetController,FiatController,WalletController,DepositController,CountryController],
  providers: [UserService,BuyService,SellService,AssetService,FiatService,WalletService,DepositService,CountryService],
  exports: [UserService, BuyService,SellService,AssetService,FiatService,WalletService,DepositService,CountryService]
})

export class AppModule {}
