import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BscService } from './bsc.service';

@Module({
  imports: [SharedModule],
  providers: [BscService],
  exports: [BscService],
})
export class BscModule {}
