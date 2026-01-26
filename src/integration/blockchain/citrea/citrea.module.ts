import { Module } from '@nestjs/common';
import { GoldskyModule } from 'src/integration/goldsky/goldsky.module';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaService } from './citrea.service';

@Module({
  imports: [SharedModule, GoldskyModule],
  providers: [CitreaService],
  exports: [CitreaService],
})
export class CitreaModule {}
