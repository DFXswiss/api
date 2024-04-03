import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateMailInput } from '../dto/create-mail.dto';
import { Notification, NotificationMetadata } from '../entities/notification.entity';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';
import { MailFactory } from '../factories/mail.factory';
import { MailRequest } from '../interfaces';
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
      const mail = this.mailFactory.createMail(request);

      await this.verify(mail);
      await this.persist(mail);

      await this.mailService.send(mail);
      await this.createOrUpdate({
        type: request.type,
        context: request.context,
        data: JSON.stringify(request.input),
        isComplete: true,
        lastTryDate: new Date(),
      });
    } catch (e) {
      await this.createOrUpdate({
        type: request.type,
        context: request.context,
        data: JSON.stringify(request.input),
        isComplete: false,
        lastTryDate: new Date(),
        error: e,
      });
      this.handleNotificationError(e, request.metadata);
    }
  }

  //*** HELPER METHODS ***//

  private async createOrUpdate(dto: CreateMailInput): Promise<Notification> {
    const existing = await this.notificationRepo.findOne({
      where: {
        type: dto.type,
        context: dto.context,
        data: dto.data,
        isComplete: dto.isComplete,
        error: dto.error,
      },
    });
    if (existing) {
      Object.assign(existing, dto);

      return this.notificationRepo.save(existing);
    }

    const entity = this.notificationRepo.create(dto);

    return this.notificationRepo.save(entity);
  }

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
