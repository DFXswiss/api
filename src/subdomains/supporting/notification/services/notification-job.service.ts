import { MailerOptions } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
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

  // Every 30s so async-enqueued mails (awaitSend:false) leave the outbox quickly; still
  // gated by Process.MAIL_RETRY. Only rows older than a few seconds are claimed so a concurrent
  // awaitSend:true path can finish first without racing the job on the same row.
  @DfxCron(CronExpression.EVERY_30_SECONDS, { process: Process.MAIL_RETRY, timeout: 7200 })
  async resendUncompletedMails(): Promise<void> {
    const uncompletedMails = await this.notificationRepo.find({
      where: { isComplete: false, created: LessThanOrEqual(Util.secondsBefore(5)) },
      order: { id: 'ASC' },
      take: 50,
    });

    for (const notification of uncompletedMails) {
      const request = NotificationService.toRequest(notification);
      const mail = this.mailFactory.createMail(request);

      if (!mail.to) {
        await this.notificationService.updateNotification(notification, {
          isComplete: true,
          error: 'No target mail defined',
        });
        continue;
      }

      Object.assign(mail, notification);

      const isSuppressed = await this.notificationService.isSuppressed(mail);
      // continue — never abort the whole batch on one suppressed row
      if (isSuppressed) continue;

      try {
        await this.mailService.send(mail);

        await this.notificationService.updateNotification(notification, { isComplete: true });
      } catch (e) {
        this.logger.error(`Error during mail send retry ${notification.id}:`, e);

        await this.notificationService.updateNotification(mail, { isComplete: false, error: e });
      }
    }
  }
}

