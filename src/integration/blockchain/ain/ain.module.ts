import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { NodeController } from './node/node.controller';
import { NodeService } from './node/node.service';
import { BtcFeeService } from './services/btc-fee.service';
import { DfiTaxService } from './services/dfi-tax.service';

@Module({
  imports: [SharedModule],
  providers: [NodeService, BtcFeeService, DfiTaxService],
  exports: [NodeService, BtcFeeService, DfiTaxService],
  controllers: [NodeController],
})
export class AinModule {}
