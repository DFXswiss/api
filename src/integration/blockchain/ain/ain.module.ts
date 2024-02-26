import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { NodeController } from './node/node.controller';
import { NodeService } from './node/node.service';
import { BtcFeeService } from './services/btc-fee.service';

@Module({
  imports: [SharedModule],
  providers: [NodeService, BtcFeeService],
  exports: [NodeService, BtcFeeService],
  controllers: [NodeController],
})
export class AinModule {}
