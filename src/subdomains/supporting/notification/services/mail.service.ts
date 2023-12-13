import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { Config, GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Mail } from '../entities/mail/base/mail';

export interface MailOptions {
  options: {
    transport: {
      host: string;
      secure: boolean;
      port: number;
      auth: { user: string; pass: string };
      tls: { rejectUnauthorized: boolean };
    };
    template: { dir: string };
  };
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
  private readonly logger = new DfxLogger(MailService);
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: GetConfig().mail.options.transport.host,
      port: GetConfig().mail.options.transport.port,
      secure: GetConfig().mail.options.transport.secure,
      requireTLS: GetConfig().mail.options.transport.tls.rejectUnauthorized,
      auth: {
        user: GetConfig().mail.options.transport.auth.user,
        pass: GetConfig().mail.options.transport.auth.pass,
      },
      logger: true,
    });
  }

  async send(mail: Mail): Promise<void> {
    try {
      const templateContent = await fs.readFileSync(`${Config.mail.options.template.dir}/${mail.template}.hbs`, 'utf8');
      const template = handlebars.compile(templateContent);
      const html = template(mail.templateParams);
      await Util.retry(
        () =>
          this.transporter.sendMail({
            from: mail.from,
            to: mail.to,
            cc: mail.cc,
            bcc: mail.bcc,
            subject: mail.subject,
            context: mail.templateParams,
            html: html,
          }),
        3,
        1000,
      );
    } catch (e) {
      this.logger.error(`Exception sending mail (from:${mail.from}, to:${mail.to}, subject:${mail.subject}):`, e);
      throw e;
    }
  }
}
