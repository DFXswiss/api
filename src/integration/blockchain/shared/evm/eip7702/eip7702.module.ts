import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { Eip7702RelayerService } from './eip7702-relayer.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [Eip7702RelayerService],
  exports: [Eip7702RelayerService],
})
export class Eip7702Module {}
