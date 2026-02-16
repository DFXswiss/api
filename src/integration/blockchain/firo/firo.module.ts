import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { FiroFeeService } from './services/firo-fee.service';
import { FiroService } from './services/firo.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [FiroService, FiroFeeService],
  exports: [FiroService, FiroFeeService],
})
export class FiroModule {}
