import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DfxLogger } from '../shared/services/dfx-logger';

@Injectable()
export class LoggerFactory {
  constructor(private readonly notificationService: NotificationService) {}

  create(context?: { name: string } | string): DfxLogger {
    return new DfxLogger(context, this.notificationService);
  }
}
