import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityOrderFactory } from './factories/liquidity-order.factory';
import { LiquidityOrderRepository } from './repositories/liquidity-order.repository';
import { DEXService } from './services/dex.service';
import { LiquidityService } from './services/liquidity.service';
import { DeFiChainUtil } from './utils/defichain.util';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityOrderRepository]), AinModule, SharedModule],
  controllers: [],
  providers: [LiquidityService, DeFiChainUtil, LiquidityOrderFactory, DEXService],
  exports: [DEXService, DeFiChainUtil],
})
export class DexModule {}
