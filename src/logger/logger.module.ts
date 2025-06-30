import { Module, forwardRef } from '@nestjs/common';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { LoggerFactory } from './logger.factory';

@Module({
  imports: [forwardRef(() => NotificationModule)],
  controllers: [],
  providers: [LoggerFactory],
  exports: [LoggerFactory],
})
export class LoggerModule {}
