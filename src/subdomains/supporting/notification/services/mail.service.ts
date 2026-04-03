import { MailerOptions } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { join } from 'path';
import { Config, Environment } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Mail } from '../entities/mail/base/mail';

// custom wallet config for UserMailV2
export interface WalletMailConfig {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for STARTTLS on 587
  user: string;
  pass: string;
  fromAddress: string;
  displayName: string;
  template: string;
}

export interface MailOptions {
  options: MailerOptions;
  defaultMailTemplate: string;
  contact: {
    supportMail: string;
    monitoringMail: string;
    liqMail: string;
    noReplyMail: string;
  };
  wallet: Record<string, Partial<WalletMailConfig>>;
}

@Injectable()
export class MailService {
  private readonly logger = new DfxLogger(MailService);
  private readonly transports = new Map<string, nodemailer.Transporter>();

  async send(mail: Mail): Promise<void> {
    if (Config.environment === Environment.LOC) {
      this.logger.info(`[LOCAL DEV] Mail skipped - to: ${mail.to}, subject: ${mail.subject}`);
      return;
    }

    try {
      const transport = this.getTransport(mail.walletName);
      const html = this.compileTemplate(mail.template, mail.templateParams);

      await transport.sendMail({
        from: { name: mail.from.name, address: mail.from.address },
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        html,
      });
    } catch (e) {
      this.logger.error(
        `Exception sending mail (from:${mail.from.name}<${mail.from.address}>, to:${mail.to}, subject:${mail.subject}):`,
        e,
      );
      throw e;
    }
  }

  private getTransport(walletName?: string): nodemailer.Transporter {
    const walletConfig = walletName ? Config.mail.wallet[walletName] : undefined;
    const key = walletConfig?.host ? walletName : 'default';

    let transport = this.transports.get(key);
    if (!transport) {
      transport = this.createTransport(walletConfig);
      this.transports.set(key, transport);
    }

    return transport;
  }

  private createTransport(walletConfig?: Partial<WalletMailConfig>): nodemailer.Transporter {
    if (walletConfig?.host) {
      return nodemailer.createTransport({
        host: walletConfig.host,
        port: walletConfig.port,
        secure: walletConfig.secure,
        auth: { user: walletConfig.user, pass: walletConfig.pass },
        tls: { rejectUnauthorized: false },
      });
    }

    return nodemailer.createTransport(Config.mail.options.transport as nodemailer.TransportOptions);
  }

  private compileTemplate(template: string, params: Record<string, unknown>): string {
    const templatePath = join(Config.mail.options.template.dir, `${template}.hbs`);
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    return handlebars.compile(templateContent)(params);
  }
}
