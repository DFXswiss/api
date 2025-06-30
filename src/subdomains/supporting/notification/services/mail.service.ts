import { MailerOptions, MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Mail } from '../entities/mail/base/mail';

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
export class MailService {
  private readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, private readonly mailerService: MailerService) {
    this.logger = loggerFactory.create(MailService);
  }

  async send(mail: Mail): Promise<void> {
    try {
      await this.mailerService.sendMail({
        from: mail.from,
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        template: mail.template,
        context: mail.templateParams,
      });
    } catch (e) {
      this.logger.error(
        `Exception sending mail (from:${mail.from.name}<${mail.from.address}>, to:${mail.to}, subject:${mail.subject}):`,
        e,
      );
      throw e;
    }
  }
}
