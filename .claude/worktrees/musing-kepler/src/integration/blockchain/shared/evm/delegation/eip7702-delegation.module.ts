import { Module } from '@nestjs/common';
import { Eip7702DelegationService } from './eip7702-delegation.service';

@Module({
  providers: [Eip7702DelegationService],
  exports: [Eip7702DelegationService],
})
export class Eip7702DelegationModule {}
