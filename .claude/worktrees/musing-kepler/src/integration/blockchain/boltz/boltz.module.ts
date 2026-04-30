import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BoltzService } from './boltz.service';

@Module({
  imports: [SharedModule],
  providers: [BoltzService],
  exports: [BoltzService],
})
export class BoltzModule {}
