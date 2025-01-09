import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { DEuroController } from './controllers/deuro.controller';
import { DEuroService } from './deuro.service';

@Module({
  imports: [SharedModule, LogModule],
  controllers: [DEuroController],
  providers: [DEuroService],
  exports: [DEuroService],
})
export class DEuroModule {}
