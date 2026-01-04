import { Module } from '@nestjs/common';
import { PimlicoPaymasterService } from './pimlico-paymaster.service';

@Module({
  providers: [PimlicoPaymasterService],
  exports: [PimlicoPaymasterService],
})
export class PimlicoPaymasterModule {}
