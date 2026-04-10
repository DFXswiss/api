import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { StarknetService } from './services/starknet.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [StarknetService],
  exports: [StarknetService],
})
export class StarknetModule {}
