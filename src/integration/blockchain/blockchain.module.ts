import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { BscModule } from './bsc/bsc.module';
import { EthereumModule } from './ethereum/ethereum.module';

@Module({
  imports: [AinModule, BscModule, EthereumModule],
  controllers: [],
  providers: [],
  exports: [AinModule, BscModule, EthereumModule],
})
export class BlockchainModule {}
