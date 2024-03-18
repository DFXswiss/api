import { Module } from '@nestjs/common';
import { ArbitrumModule } from '../arbitrum/arbitrum.module';
import { Ebel2xService } from './ebel2x.service';

@Module({
  imports: [ArbitrumModule],
  controllers: [],
  providers: [Ebel2xService],
  exports: [Ebel2xService],
})
export class Ebel2xModule {}
