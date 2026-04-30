import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { BscService } from './bsc.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [BscService],
  exports: [BscService],
})
export class BscModule {}
