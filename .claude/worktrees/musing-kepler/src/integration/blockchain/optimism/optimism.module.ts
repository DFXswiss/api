import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { OptimismService } from './optimism.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [OptimismService],
  exports: [OptimismService],
})
export class OptimismModule {}
