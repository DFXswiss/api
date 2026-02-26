import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { NodeController } from './node/node.controller';
import { BitcoinFeeService } from './services/bitcoin-fee.service';
import { BitcoinService } from './services/bitcoin.service';

@Module({
  imports: [SharedModule],
  providers: [BitcoinService, BitcoinFeeService],
  exports: [BitcoinService, BitcoinFeeService],
  controllers: [NodeController],
})
export class BitcoinModule {}
