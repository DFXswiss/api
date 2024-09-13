import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { RouteController } from './route.controller';
import { Route } from './route.entity';
import { RouteRepository } from './route.repository';
import { RouteService } from './route.service';

@Module({
  imports: [TypeOrmModule.forFeature([Route]), BuyCryptoModule, SellCryptoModule],
  controllers: [RouteController],
  providers: [RouteService, RouteRepository],
  exports: [],
})
export class RouteModule {}
