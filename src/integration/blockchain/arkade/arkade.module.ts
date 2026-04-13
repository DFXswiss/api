import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ArkadeService } from './arkade.service';

@Module({
  imports: [SharedModule],
  providers: [ArkadeService],
  exports: [ArkadeService],
})
export class ArkadeModule {}
