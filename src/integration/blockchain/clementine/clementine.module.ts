import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ClementineService } from './clementine.service';

@Module({
  imports: [SharedModule],
  providers: [ClementineService],
  exports: [ClementineService],
})
export class ClementineModule {}
