import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { FiatOutputController } from '../fiat-output/fiat-output.controller';
import { FiatOutput } from '../fiat-output/fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output/fiat-output.repository';
import { FiatOutputService } from '../fiat-output/fiat-output.service';
import { Ep2ReportService } from './ep2-report.service';
import { FiatOutputJobService } from './fiat-output-job.service';

@Module({
  imports: [TypeOrmModule.forFeature([FiatOutput]), SharedModule, forwardRef(() => BankTxModule)],

  controllers: [FiatOutputController],
  providers: [
    FiatOutputRepository,
    BuyFiatRepository,
    BuyCryptoRepository,
    FiatOutputService,
    Ep2ReportService,
    FiatOutputJobService,
  ],
  exports: [FiatOutputService],
})
export class FiatOutputModule {}
