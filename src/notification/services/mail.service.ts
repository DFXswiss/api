import { MailerOptions, MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { Util } from '../../shared/util';
import { Mail } from '../entities/mail/mail';

export interface MailOptions {
  options: MailerOptions;
  defaultMailTemplate: string;
  contact: {
    supportMail: string;
    monitoringMail: string;
    noReplyMail: string;
  };
}

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async send(mail: Mail): Promise<void> {
    try {
      await Util.retry(
        () =>
          this.mailerService.sendMail({
            from: mail.from,
            to: mail.to,
            cc: mail.cc,
            bcc: mail.bcc,
            template: mail.template,
            context: {
              salutation: mail.salutation,
              body: mail.body,
              date: mail.date,
              telegramUrl: mail.telegramUrl,
              twitterUrl: mail.twitterUrl,
              linkedinUrl: mail.linkedinUrl,
              instagramUrl: mail.instagramUrl,
            },
            subject: mail.subject,
          }),
        3,
        1000,
      );
    } catch (e) {
      console.error(`Exception during send mail: from:${mail.from}, to:${mail.to}, subject:${mail.subject}:`, e);
      throw e;
    }
  }
}
