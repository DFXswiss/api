import { Module } from '@nestjs/common';
import { PimlicoBundlerService } from './pimlico-bundler.service';
import { PimlicoPaymasterService } from './pimlico-paymaster.service';

@Module({
  providers: [PimlicoPaymasterService, PimlicoBundlerService],
  exports: [PimlicoPaymasterService, PimlicoBundlerService],
})
export class PimlicoPaymasterModule {}
