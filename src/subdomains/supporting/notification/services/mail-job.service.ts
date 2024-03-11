import { MailerOptions } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { IsNull } from 'typeorm';
import { MailRepository } from '../repositories/mail.repository';
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
export class MailJobService {
  constructor(private readonly mailRepo: MailRepository, private readonly notificationService: NotificationService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(7200)
  async resendUncompletedMails(): Promise<void> {
    if (DisabledProcess(Process.RESEND_UNCOMPLETED_MAILS)) return;
    const uncompletedMails = await this.mailRepo.find({
      where: { isComplete: false, error: IsNull() },
    });

    for (const mail of uncompletedMails) {
      await this.notificationService.sendMail({ type: mail.type, context: mail.context, input: JSON.parse(mail.data) });
    }
  }
}
