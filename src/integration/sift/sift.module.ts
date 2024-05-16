import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { SiftService } from './services/sift.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [SiftService],
  exports: [SiftService],
})
export class SiftModule {}
