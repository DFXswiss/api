import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { GnosisService } from './gnosis.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  controllers: [],
  providers: [GnosisService],
  exports: [GnosisService],
})
export class GnosisModule {}
