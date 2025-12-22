import { Module } from '@nestjs/common';
import { Eip7702RelayerService } from './eip7702-relayer.service';

@Module({
  providers: [Eip7702RelayerService],
  exports: [Eip7702RelayerService],
})
export class Eip7702Module {}
