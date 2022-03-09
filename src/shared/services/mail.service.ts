import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { KycStatus, UserData } from 'src/user/models/user-data/user-data.entity';
import { Config } from 'src/config/config';
import { Util } from '../util';
import { I18nService } from 'nestjs-i18n';

interface SendMailDto {
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

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';
  private readonly monitoringMail = 'monitoring@dfx.swiss';
  private readonly noReplyMail = 'noreply@dfx.swiss';
  private readonly kycStatus = {
    [KycStatus.CHATBOT]: 'Chatbot',
    [KycStatus.ONLINE_ID]: 'Online ID',
    [KycStatus.VIDEO_ID]: 'Video ID',
  };

  constructor(private readonly mailerService: MailerService, private readonly i18n: I18nService) {}

  async sendKycReminderMail(to: string, kycStatus: KycStatus, language: string, url: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.reminder.salutation', {
      lang: language,
    });

    const body = await this.i18n.translate('mail.kyc.reminder.body', {
      lang: language,
      args: { status: this.kycStatus[kycStatus], url: url },
    });

    const subject = await this.i18n.translate('mail.kyc.reminder.title', {
      lang: language,
    });

    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendChatbotCompleteMail(to: string, language: string, url: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.chatbot.salutation', {
      lang: language,
    });
    const body = await this.i18n.translate('mail.kyc.chatbot.body', {
      lang: language,
      args: { url: url },
    });
    const subject = await this.i18n.translate('mail.kyc.chatbot.title', {
      lang: language,
    });
    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendIdentificationCompleteMail(to: string, language: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.ident.salutation', {
      lang: language,
    });
    const body = await this.i18n.translate('mail.kyc.ident.body', {
      lang: language,
    });
    const subject = await this.i18n.translate('mail.kyc.ident.title', {
      lang: language,
    });
    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendOnlineFailedMail(to: string, language: string, url: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.failed.salutation', {
      lang: language,
    });
    const body = await this.i18n.translate('mail.kyc.failed.body', {
      lang: language,
      args: { url: url },
    });
    const subject = await this.i18n.translate('mail.kyc.failed.title', {
      lang: language,
    });
    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendKycFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
    const body = `
    <p>a customer has failed or expired during progress ${this.kycStatus[userData.kycStatus]}.</p>
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

    await this.sendMailInternal({
      to: this.supportMail,
      salutation: 'Hi DFX Support',
      subject: 'KYC failed or expired',
      body,
    });
  }

  async sendErrorMail(subject: string, errors: string[]): Promise<void> {
    const env = Config.environment.toUpperCase();

    const body = `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;

    await this.sendMailInternal({
      to: this.monitoringMail,
      salutation: 'Hi DFX Tech Support',
      subject: `${subject} (${env})`,
      body,
    });
  }

  async sendMailInternal(sendMailDto: SendMailDto) {
    try {
      await this.sendMail(sendMailDto);
    } catch (e) {
      console.error(
        `Exception during send mail: from:${sendMailDto.from}, to:${sendMailDto.to}, subject:${sendMailDto.subject}:`,
        e,
      );
    }
  }

  async sendMail(sendMailDto: SendMailDto) {
    await Util.retry(
      () =>
        this.mailerService.sendMail({
          from: { name: sendMailDto.displayName ?? 'DFX.swiss', address: sendMailDto.from ?? this.noReplyMail },
          to: sendMailDto.to,
          cc: sendMailDto.cc,
          bcc: sendMailDto.bcc,
          template: sendMailDto.template ?? Config.defaultMailTemplate,
          context: {
            salutation: sendMailDto.salutation,
            body: sendMailDto.body,
            date: new Date().getFullYear(),
            telegramUrl: sendMailDto.telegramUrl ?? Config.defaultTelegramUrl,
            twitterUrl: sendMailDto.twitterUrl ?? Config.defaultTwitterUrl,
            linkedinUrl: sendMailDto.linkedinUrl ?? Config.defaultLinkedinUrl,
            instagramUrl: sendMailDto.instagramUrl ?? Config.defaultInstagramUrl,
          },
          subject: sendMailDto.subject,
        }),
      3,
      1000,
    );
  }
}
