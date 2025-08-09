import { Module } from '@nestjs/common';
import { GoldskyService } from './goldsky.service';

@Module({
  providers: [GoldskyService],
  exports: [GoldskyService],
})
export class GoldskyModule {}