import { Injectable } from '@nestjs/common';
import { Notification, NotificationMetadata } from '../entities/notification.entity';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';
import { MailFactory } from '../factories/mail.factory';
import { MailRequest } from '../interfaces';
import { NotificationRepository } from '../repositories/notification.repository';
import { MailService } from './mail.service';

@Injectable()
export class NotificationService {
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

  //*** HELPER METHODS ***//

  private async verify(newNotification: Notification): Promise<void> {
    const { correlationId, context } = newNotification;

    const existingNotification = await this.notificationRepo.findOne({
      order: { id: 'DESC' },
      where: { correlationId, context },
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
      console.info(`Suppressed mail request. Context: ${metadata?.context}. CorrelationId: ${metadata?.correlationId}`);
      return;
    }

    throw e;
  }
}
