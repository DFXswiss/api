import { Injectable } from '@nestjs/common';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { Notification } from '../entities/notification.entity';
import { MailFactory } from '../factories/mail.factory';
import { MailRequest } from '../interfaces';
import { NotificationRepository } from '../repositories/notification.repository';
import { MailService } from './mail.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly logger: DfxLoggerService,
    private readonly mailFactory: MailFactory,
    private readonly mailService: MailService,
    private readonly notificationRepo: NotificationRepository,
  ) {
    this.logger.create(NotificationService);
  }

  async sendMail(request: MailRequest): Promise<void> {
    const mail = this.mailFactory.createMail(request);
    if (!mail) return;

    Object.assign(mail, NotificationService.fromRequest(request));

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

  async getMails(userDataId: number): Promise<Notification[]> {
    return this.notificationRepo.find({ where: { userData: { id: userDataId } } });
  }

  //*** HELPER METHODS ***//

  static fromRequest(request: MailRequest): Partial<Notification> {
    let update: Partial<Notification> = {};

    if ('userData' in request.input) {
      update = {
        data: JSON.stringify({
          ...request.input,
          userData: {
            id: request.input.userData.id,
            mail: request.input.userData.mail,
            language: { id: request.input.userData.language.id, symbol: request.input.userData.language.symbol },
          },
        }),
        userData: request.input.userData,
      };

      request.input.userData = undefined;
    }

    return {
      type: request.type,
      context: request.context,
      data: JSON.stringify(request.input),
      lastTryDate: new Date(),
      debounce: request.options?.debounce,
      suppressRecurring: request.options?.suppressRecurring,
      correlationId: request.correlationId,
      ...update,
    };
  }

  static toRequest(notification: Notification): MailRequest {
    return {
      type: notification.type,
      context: notification.context,
      input: notification.data === '-' ? null : JSON.parse(notification.data),
      correlationId: notification.correlationId,
      options: {
        suppressRecurring: notification.suppressRecurring,
        debounce: notification.debounce,
      },
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
