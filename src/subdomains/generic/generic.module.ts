import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ForwardingModule } from './forwarding/forwarding.module';
import { GsModule } from './gs/gs.module';
import { KycModule } from './kyc/kyc.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [AdminModule, UserModule, GsModule, KycModule, ForwardingModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class GenericModule {}
