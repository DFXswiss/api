import { MailerOptions } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { LessThanOrEqual } from 'typeorm';
import { MailFactory } from '../factories/mail.factory';
import { NotificationRepository } from '../repositories/notification.repository';
import { MailService } from './mail.service';
import { NotificationService } from './notification.service';

export interface MailOptions {
  options: MailerOptions;
  defaultMailTemplate: string;
  contact: {
    supportMail: string;
    monitoringMail: string;
    liqMail: string;
    noReplyMail: string;
  };
}

@Injectable()
export class NotificationJobService {
  private readonly logger = new DfxLogger(NotificationJobService);

  constructor(
    private readonly notificationRepo: NotificationRepository,
    private readonly notificationService: NotificationService,
    private readonly mailFactory: MailFactory,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(7200)
  async resendUncompletedMails(): Promise<void> {
    if (DisabledProcess(Process.MAIL_RETRY)) return;

    const uncompletedMails = await this.notificationRepo.find({
      where: { isComplete: false, created: LessThanOrEqual(Util.minutesBefore(1)) },
    });

    for (const notification of uncompletedMails) {
      const request = NotificationService.toRequest(notification);
      const mail = this.mailFactory.createMail(request);

      Object.assign(mail, notification);

      const isSuppressed = await this.notificationService.isSuppressed(mail);
      if (isSuppressed) return;

      try {
        await this.mailService.send(mail);

        await this.notificationService.updateNotification(notification, { isComplete: true });
      } catch (e) {
        this.logger.error('Error during mail send retry:', e);

        await this.notificationService.updateNotification(mail, { isComplete: false, error: e });
      }
    }
  }
}
