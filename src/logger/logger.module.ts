import { Module, forwardRef } from '@nestjs/common';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DfxLogger } from './dfx-logger.service';
import { LoggerFactory } from './logger.factory';

@Module({
  imports: [forwardRef(() => NotificationModule)],
  controllers: [],
  providers: [LoggerFactory, DfxLogger],
  exports: [LoggerFactory, DfxLogger],
})
export class LoggerModule {}
