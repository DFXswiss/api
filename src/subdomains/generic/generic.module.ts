import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { GsModule } from './gs/gs.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [AdminModule, UserModule, GsModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class GenericModule {}
