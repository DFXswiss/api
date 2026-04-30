import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BlockscoutService } from './blockscout.service';

@Module({
  imports: [SharedModule],
  providers: [BlockscoutService],
  exports: [BlockscoutService],
})
export class BlockscoutModule {}
