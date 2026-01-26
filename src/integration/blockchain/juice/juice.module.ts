import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { JuiceController } from './controllers/juice.controller';
import { JuiceService } from './juice.service';

@Module({
  imports: [SharedModule, LogModule],
  controllers: [JuiceController],
  providers: [JuiceService],
  exports: [JuiceService],
})
export class JuiceModule {}
