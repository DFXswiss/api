import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ZanoService } from './services/zano.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [ZanoService],
  exports: [ZanoService],
})
export class ZanoModule {}
