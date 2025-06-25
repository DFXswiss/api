import { Module } from '@nestjs/common';
import { LoggerModule } from 'src/logger/logger.module';
import { SharedModule } from 'src/shared/shared.module';
import { BitcoinService } from './node/bitcoin.service';
import { NodeController } from './node/node.controller';
import { BitcoinFeeService } from './services/bitcoin-fee.service';

@Module({
  imports: [SharedModule, LoggerModule],
  providers: [BitcoinService, BitcoinFeeService],
  exports: [BitcoinService, BitcoinFeeService],
  controllers: [NodeController],
})
export class BitcoinModule {}
