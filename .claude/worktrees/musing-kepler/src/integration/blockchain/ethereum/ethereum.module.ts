import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { EthereumService } from './ethereum.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [EthereumService],
  exports: [EthereumService],
})
export class EthereumModule {}
