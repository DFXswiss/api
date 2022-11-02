import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [AdminModule, UserModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class GenericModule {}
