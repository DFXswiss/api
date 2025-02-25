import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { ReferralModule } from '../referral/referral.module';
import { CustodyController } from './controllers/custody.controller';
import { CustodyService } from './services/custody-service';

@Module({
  imports: [UserModule, ReferralModule, SharedModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
