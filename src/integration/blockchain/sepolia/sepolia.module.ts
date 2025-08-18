import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { SepoliaService } from './sepolia.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [SepoliaService],
  exports: [SepoliaService],
})
export class SepoliaModule {}