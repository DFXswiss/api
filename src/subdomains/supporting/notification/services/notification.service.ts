import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { Notification } from '../entities/notification.entity';
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
    const mail = this.mailFactory.createMail(request);

    Object.assign(mail, NotificationService.parseDefaultMailParams(request));

    const isSuppressed = await this.isSuppressed(mail);
    if (isSuppressed) return;

    await this.notificationRepo.save(mail);

    try {
      await this.mailService.send(mail);

      await this.updateNotification(mail, { isComplete: true });
    } catch (e) {
      this.logger.error('Error in sendMail', e);

      await this.updateNotification(mail, { isComplete: false, error: e });
    }
  }

  //*** HELPER METHODS ***//

  static parseDefaultMailParams(request: MailRequest): Partial<Notification> {
    return {
      type: request.type,
      context: request.context,
      data: JSON.stringify(request.input),
      isComplete: false,
      lastTryDate: new Date(),
      debounce: request.options?.debounce,
      suppressRecurring: request.options?.suppressRecurring,
      correlationId: request.correlationId,
    };
  }

  public async updateNotification(entity: Notification, dto: UpdateNotificationDto): Promise<Notification> {
    Object.assign(entity, dto);

    return this.notificationRepo.save(entity);
  }

  public async isSuppressed(newNotification: Notification): Promise<boolean> {
    const { correlationId, context } = newNotification;

    const existingNotification = await this.notificationRepo.findOne({
      where: { correlationId, context },
      order: { id: 'DESC' },
    });
    if (existingNotification) return newNotification.isSuppressed(existingNotification);
  }
}
