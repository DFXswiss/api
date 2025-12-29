import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { FrankencoinController } from './controllers/frankencoin.controller';
import { FrankencoinService } from './frankencoin.service';

@Module({
  imports: [SharedModule, LogModule],
  controllers: [FrankencoinController],
  providers: [FrankencoinService],
  exports: [FrankencoinService],
})
export class FrankencoinModule {}
