import { Module } from '@nestjs/common';
import { EthereumService } from './ethereum.service';

@Module({
  imports: [],
  providers: [EthereumService],
  exports: [EthereumService],
})
export class EthereumModule {}
