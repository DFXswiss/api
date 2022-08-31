import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { EthereumModule } from '../ethereum/ethereum.module';
import { BSCService } from './bsc.service';

@Module({
  imports: [SharedModule, EthereumModule],
  providers: [BSCService],
  exports: [BSCService],
})
export class BSCModule {}
