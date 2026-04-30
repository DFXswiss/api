import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ArkService } from './ark.service';

@Module({
  imports: [SharedModule],
  providers: [ArkService],
  exports: [ArkService],
})
export class ArkModule {}
