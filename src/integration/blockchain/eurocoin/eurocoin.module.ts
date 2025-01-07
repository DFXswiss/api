import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { EurocoinController } from './controllers/eurocoin.controller';
import { EurocoinService } from './eurocoin.service';

@Module({
  imports: [SharedModule, LogModule],
  controllers: [EurocoinController],
  providers: [EurocoinService],
  exports: [EurocoinService],
})
export class EurocoinModule {}
