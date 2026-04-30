import { Module } from '@nestjs/common';
import { BlockscoutModule } from 'src/integration/blockchain/shared/blockscout/blockscout.module';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaService } from './citrea.service';

@Module({
  imports: [SharedModule, BlockscoutModule],
  providers: [CitreaService],
  exports: [CitreaService],
})
export class CitreaModule {}
