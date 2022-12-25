import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ArbitrumService } from './arbitrum.service';

@Module({
  imports: [SharedModule],
  providers: [ArbitrumService],
  exports: [ArbitrumService],
})
export class ArbitrumModule {}
