import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { BankModule } from '../bank/bank.module';
import { FiatOutputController } from '../fiat-output/fiat-output.controller';
import { FiatOutput } from '../fiat-output/fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output/fiat-output.repository';
import { FiatOutputService } from '../fiat-output/fiat-output.service';
import { LogModule } from '../log/log.module';
import { Ep2ReportService } from './ep2-report.service';
import { FiatOutputJobService } from './fiat-output-job.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FiatOutput]),
    SharedModule,
    forwardRef(() => BankTxModule),
    BankModule, // VirtualIbanService is exported from BankModule
    BankIntegrationModule,
    forwardRef(() => LiquidityManagementModule),
    LogModule,
  ],

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
