import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { InternetComputerController } from './icp.controller';
import { InternetComputerService } from './services/icp.service';

@Module({
  imports: [SharedModule],
  controllers: [InternetComputerController],
  providers: [InternetComputerService],
  exports: [InternetComputerService],
})
export class InternetComputerModule {}
