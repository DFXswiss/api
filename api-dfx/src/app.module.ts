import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm';
import config from './config/config';
import { TypeOrmConfig } from './config/typeorm.config';
import { AppController } from './app.controller';
import { UserController } from './user/user.controller';
import { BuyController } from './buy/buy.controller';
import { SellController } from './sell/sell.controller';
import { UserService } from './user/user.service';
import { BuyService } from './buy/buy.service';
import { SellService } from './sell/sell.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config],
    }),
  ],
  controllers: [AppController, UserController, BuyController,SellController],
  providers: [UserService,BuyService,SellService],
  exports: [UserService, BuyService,SellService]
})

export class AppModule {}
