import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { FiatOutputController } from '../fiat-output/fiat-output.controller';
import { FiatOutput } from '../fiat-output/fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output/fiat-output.repository';
import { FiatOutputService } from '../fiat-output/fiat-output.service';

@Module({
  imports: [TypeOrmModule.forFeature([FiatOutput]), SharedModule, BankTxModule],

  controllers: [FiatOutputController],
  providers: [FiatOutputRepository, BuyFiatRepository, FiatOutputService],
  exports: [FiatOutputService],
})
export class FiatOutputModule {}
