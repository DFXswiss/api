import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

@Injectable()
export class LoggerFactory {
  constructor(private readonly notificationService: NotificationService) {}

  create(context?: { name: string } | string): DfxLogger {
    return new DfxLogger(context, this.notificationService);
  }
}
