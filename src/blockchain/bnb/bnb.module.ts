import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { EthereumModule } from '../ethereum/ethereum.module';
import { BNBService } from './bnb.service';

@Module({
  imports: [SharedModule, EthereumModule],
  providers: [BNBService],
  exports: [BNBService],
})
export class BNBModule {}
