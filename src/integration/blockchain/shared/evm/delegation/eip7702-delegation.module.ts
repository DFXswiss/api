import { Module } from '@nestjs/common';
import { PimlicoPaymasterService } from '../paymaster/pimlico-paymaster.service';
import { Eip7702DelegationService } from './eip7702-delegation.service';

@Module({
  providers: [Eip7702DelegationService, PimlicoPaymasterService],
  exports: [Eip7702DelegationService, PimlicoPaymasterService],
})
export class Eip7702DelegationModule {}
