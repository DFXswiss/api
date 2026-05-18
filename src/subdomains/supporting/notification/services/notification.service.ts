import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { DataSource, In } from 'typeorm';
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
    private readonly dataSource: DataSource,
  ) {}

  async sendMail(request: MailRequest): Promise<void> {
    await this.resolveMailWallet(request);

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

  private async resolveMailWallet(request: MailRequest): Promise<void> {
    const input = request.input;
    if (!('userData' in input) || !input.userData?.id) return;

    // skip if caller explicitly set a wallet
    if (input.wallet) return;

    const brandedWalletNames = Object.entries(Config.mail.wallet)
      .filter(([, config]) => config.isPreferred)
      .map(([name]) => name);

    const mailWallet = brandedWalletNames.length
      ? await this.dataSource
          .getRepository(User)
          .findOne({
            where: { userData: { id: input.userData.id }, wallet: { name: In(brandedWalletNames) } },
            relations: { wallet: true },
          })
          .then((u) => u?.wallet)
      : undefined;

    input.wallet = mailWallet ?? input.userData.wallet;
  }
}
