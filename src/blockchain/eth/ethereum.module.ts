import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { EthereumService } from './ethereum.service';

@Module({
  imports: [SharedModule],
  providers: [EthereumService],
  exports: [EthereumService],
})
export class EthereumModule {}
