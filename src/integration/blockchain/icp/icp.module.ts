import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { InternetComputerService } from './services/icp.service';

@Module({
  imports: [SharedModule],
  providers: [InternetComputerService],
  exports: [InternetComputerService],
})
export class InternetComputerModule {}
