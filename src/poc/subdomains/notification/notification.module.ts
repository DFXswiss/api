import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { SharedModule } from 'src/shared/shared.module';
import { NotifyAdminHandler } from './handlers/notify-admin.handler';
import { NotifyUserHandler } from './handlers/notify-user.handler';

@Module({
  imports: [CqrsModule, SharedModule],
  controllers: [],
  providers: [NotifyUserHandler, NotifyAdminHandler],
  exports: [],
})
export class NotificationModule {}
