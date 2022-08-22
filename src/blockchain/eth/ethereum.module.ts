import { Module } from '@nestjs/common';
import { EthereumClient } from './ethereum-client';

@Module({
  imports: [],
  providers: [EthereumClient],
  exports: [EthereumClient],
})
export class EthereumModule {}
