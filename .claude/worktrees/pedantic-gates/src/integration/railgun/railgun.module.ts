import { Module } from '@nestjs/common';
import { RailgunService } from './railgun.service';

@Module({
  providers: [RailgunService],
  exports: [RailgunService],
})
export class RailgunModule {}
