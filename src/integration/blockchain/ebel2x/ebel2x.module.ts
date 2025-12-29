import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { Ebel2xService } from './ebel2x.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  controllers: [],
  providers: [Ebel2xService],
  exports: [Ebel2xService],
})
export class Ebel2xModule {}
