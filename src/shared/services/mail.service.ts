import { MailerOptions, MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { UserData } from 'src/user/models/user-data/user-data.entity';
import { Config } from 'src/config/config';
import { Util } from '../util';
import { I18nService } from 'nestjs-i18n';
import { UserDataService } from 'src/user/models/user-data/user-data.service';

export interface MailOptions {
  options: MailerOptions;
  defaultMailTemplate: string;
  contact: {
    supportMail: string;
    monitoringMail: string;
    noReplyMail: string;
  };
}

interface SendMailOptions {
  to: string;
  salutation: string;
  subject: string;
  body: string;
  from?: string;
  bcc?: string;
  cc?: string;
  displayName?: string;
  template?: string;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
}

interface TranslationOptions {
  userData: UserData;
  translationKey: string;
  params?: object;
}

interface KycMailContent {
  salutation: string;
  body: string;
  subject: string;
}

@Injectable()
export class MailService {
  private readonly supportMail = Config.mail.contact.supportMail;
  private readonly monitoringMail = Config.mail.contact.monitoringMail;
  private readonly noReplyMail = Config.mail.contact.noReplyMail;

  constructor(
    private readonly mailerService: MailerService,
    private readonly i18n: I18nService,
    private readonly userDataService: UserDataService,
  ) {}

  // --- KYC --- //

  async sendKycFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
    const body = `
    <p>a customer has failed or expired during progress ${this.userDataService.kycStatus[userData.kycStatus]}.</p>
      <table>
          <tr>
              <td>Reference:</td>
              <td>${userData.id}</td>
          </tr>
          <tr>
              <td>Customer ID:</td>
              <td>${kycCustomerId}</td>
          </tr>
      </table>
    `;

    await this.sendMail({
      to: this.supportMail,
      salutation: 'Hi DFX Support',
      subject: 'KYC failed or expired',
      body,
    });
  }

  // --- OTHER --- //
  async sendErrorMail(subject: string, errors: string[]): Promise<void> {
    const env = Config.environment.toUpperCase();

    const body = `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;

    await this.sendMail({
      to: this.monitoringMail,
      salutation: 'Hi DFX Tech Support',
      subject: `${subject} (${env})`,
      body,
    });
  }

  async sendTranslatedMail(translationOptions: TranslationOptions): Promise<void> {
    const { salutation, body, subject } = await this.t(
      translationOptions.translationKey,
      translationOptions.userData.language.symbol.toLowerCase(),
      translationOptions.params,
    );

    await this.sendMail({ to: translationOptions.userData.mail, salutation, subject, body, template: 'default' });
  }

  async sendMail(options: SendMailOptions) {
    try {
      await Util.retry(
        () =>
          this.mailerService.sendMail({
            from: { name: options.displayName ?? 'DFX.swiss', address: options.from ?? this.noReplyMail },
            to: options.to,
            cc: options.cc,
            bcc: options.bcc,
            template: options.template ?? Config.mail.defaultMailTemplate,
            context: {
              salutation: options.salutation,
              body: options.body,
              date: new Date().getFullYear(),
              telegramUrl: options.telegramUrl ?? Config.defaultTelegramUrl,
              twitterUrl: options.twitterUrl ?? Config.defaultTwitterUrl,
              linkedinUrl: options.linkedinUrl ?? Config.defaultLinkedinUrl,
              instagramUrl: options.instagramUrl ?? Config.defaultInstagramUrl,
            },
            subject: options.subject,
          }),
        3,
        1000,
      );
    } catch (e) {
      console.error(
        `Exception during send mail: from:${options.from}, to:${options.to}, subject:${options.subject}:`,
        e,
      );
      throw e;
    }
  }

  private async t(key: string, lang: string, args?: any): Promise<KycMailContent> {
    const salutation = await this.i18n.translate(`${key}.salutation`, { lang, args });
    const body = await this.i18n.translate(`${key}.body`, { lang, args });
    const subject = await this.i18n.translate(`${key}.title`, { lang, args });

    return { salutation, body, subject };
  }
}
