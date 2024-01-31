import { Module } from '@nestjs/common';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { FrankencoinService } from './frankencoin.service';

@Module({
  imports: [LogModule],
  controllers: [],
  providers: [FrankencoinService],
  exports: [],
})
export class FrankencoinModule {}
