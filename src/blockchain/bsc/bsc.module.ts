import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { EthereumModule } from '../ethereum/ethereum.module';
import { BscService } from './bsc.service';

@Module({
  imports: [SharedModule, EthereumModule],
  providers: [BscService],
  exports: [BscService],
})
export class BscModule {}
