import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { ArbitrumService } from './arbitrum.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [ArbitrumService],
  exports: [ArbitrumService],
})
export class ArbitrumModule {}
