import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BtcService } from './node/btc.service';
import { NodeController } from './node/node.controller';
import { BtcFeeService } from './services/btc-fee.service';

@Module({
  imports: [SharedModule],
  providers: [BtcService, BtcFeeService],
  exports: [BtcService, BtcFeeService],
  controllers: [NodeController],
})
export class AinModule {}
