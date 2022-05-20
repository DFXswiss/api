import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { KycStatus, UserData } from 'src/user/models/user-data/user-data.entity';
import { Config } from 'src/config/config';
import { Util } from '../util';
import { I18nService } from 'nestjs-i18n';
import { StakingRefType } from 'src/payment/models/staking-ref-reward/staking-ref-reward.entity';

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

interface KycMailContent {
  salutation: string;
  body: string;
  subject: string;
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

  // --- KYC --- //
  async sendKycReminderMail(to: string, kycStatus: KycStatus, language: string, url: string): Promise<void> {
    const { salutation, body, subject } = await this.t('mail.kyc.reminder', language, {
      status: this.kycStatus[kycStatus],
      url: url,
    });

    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendChatbotCompleteMail(to: string, language: string, url: string): Promise<void> {
    const { salutation, body, subject } = await this.t('mail.kyc.chatbot', language, {
      url: url,
    });
    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendIdentificationCompleteMail(to: string, language: string): Promise<void> {
    const { salutation, body, subject } = await this.t('mail.kyc.ident', language);
    await this.sendMailInternal({ to, salutation, subject, body, template: 'default' });
  }

  async sendOnlineFailedMail(to: string, language: string, url: string): Promise<void> {
    const { salutation, body, subject } = await this.t('mail.kyc.failed', language, {
      url: url,
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

  // --- PAYMENT PROCESSING --- //
  async sendStakingRefMail(to: string, language: string, stakingRefType: StakingRefType): Promise<void> {
    const { salutation, body, subject } = await this.t(
      `mail.stakingRef.${stakingRefType.toString().toLowerCase()}`,
      language,
    );
    await this.sendMail({ to, salutation, subject, body, template: 'default' });
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

    await this.sendMailInternal({
      to: this.monitoringMail,
      salutation: 'Hi DFX Tech Support',
      subject: `${subject} (${env})`,
      body,
    });
  }

  async sendMailInternal(options: SendMailOptions) {
    try {
      await this.sendMail(options);
    } catch (e) {
      console.error(
        `Exception during send mail: from:${options.from}, to:${options.to}, subject:${options.subject}:`,
        e,
      );
    }
  }

  async sendMail(options: SendMailOptions) {
    await Util.retry(
      () =>
        this.mailerService.sendMail({
          from: { name: options.displayName ?? 'DFX.swiss', address: options.from ?? this.noReplyMail },
          to: options.to,
          cc: options.cc,
          bcc: options.bcc,
          template: options.template ?? Config.defaultMailTemplate,
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
  }

  private async t(key: string, lang: string, args?: any): Promise<KycMailContent> {
    const salutation = await this.i18n.translate(`${key}.salutation`, { lang, args });
    const body = await this.i18n.translate(`${key}.body`, { lang, args });
    const subject = await this.i18n.translate(`${key}.title`, { lang, args });

    return { salutation, body, subject };
  }
}
