import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Notification, NotificationMetadata } from '../entities/notification.entity';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';
import { MailFactory } from '../factories/mail.factory';
import { MailRequest, MailRequestNew } from '../interfaces';
import { NotificationRepository } from '../repositories/notification.repository';
import { MailService } from './mail.service';

@Injectable()
export class NotificationService {
  private readonly logger = new DfxLogger(NotificationService);

  constructor(
    private readonly mailFactory: MailFactory,
    private readonly mailService: MailService,
    private readonly notificationRepo: NotificationRepository,
  ) {}

  async sendMail(request: MailRequest): Promise<void> {
    try {
      const mail = await this.mailFactory.createMail(request);

      await this.verify(mail);
      await this.persist(mail);

      await this.mailService.send(mail);
    } catch (e) {
      this.handleNotificationError(e, request.metadata);
    }
  }

  async sendMailNew(request: MailRequestNew): Promise<void> {
    try {
      const mail = this.mailFactory.createMailNew(request);

      await this.verify(mail);
      await this.persist(mail);

      await this.mailService.send(mail);
    } catch (e) {
      this.handleNotificationError(e, request.metadata);
    }
  }

  //*** HELPER METHODS ***//

  private async verify(newNotification: Notification): Promise<void> {
    const { correlationId, context } = newNotification;

    const existingNotification = await this.notificationRepo.findOne({
      where: { correlationId, context },
      order: { id: 'DESC' },
    });

    if (existingNotification) newNotification.shouldAbortGiven(existingNotification);
  }

  private async persist(notification: Notification): Promise<void> {
    if (notification.shouldBePersisted()) {
      await this.notificationRepo.save(notification);
    }
  }

  //*** ERROR HANDLING ***//

  private handleNotificationError(e: Error, metadata: NotificationMetadata): void {
    if (e instanceof NotificationSuppressedException) {
      this.logger.verbose(
        `Suppressed mail request. Context: ${metadata?.context}. CorrelationId: ${metadata?.correlationId}`,
      );
      return;
    }

    throw e;
  }
}
