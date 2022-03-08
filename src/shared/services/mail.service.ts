import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { KycStatus, UserData } from 'src/user/models/user-data/user-data.entity';
import { Config } from 'src/config/config';
import { Util } from '../util';
import { I18nService } from 'nestjs-i18n';
import { Language } from '../models/language/language.entity';

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

  async sendKycReminderMail(mail: string, kycStatus: KycStatus, language: string, url: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.reminder.salutation', {
      lang: language,
      args: { status: this.kycStatus[kycStatus] },
    });

    const body = await this.i18n.translate('mail.kyc.reminder.body', {
      lang: language,
      args: { url: url },
    });

    const title = await this.i18n.translate('mail.kyc.reminder.title', {
      lang: language,
    });

    await this.sendMailInternal(mail, salutation, title, body);
  }

  async sendChatbotCompleteMail(mail: string, language: string, url: string): Promise<void> {
    const salutation = await this.i18n.translate('mail.kyc.chatbot.salutation', {
      lang: language,
    });
    const body = await this.i18n.translate('mail.kyc.chatbot.body', {
      lang: language,
      args: { url: url },
    });
    const title = await this.i18n.translate('mail.kyc.chatbot.title', {
      lang: language,
    });
    await this.sendMailInternal(mail, salutation, title, body);
  }

  async sendIdentificationCompleteMail(firstName: string, mail: string, language: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>du hast KYC abgeschlossen und bist nun provisorisch verifiziert. Von deiner Seite sind keine weiteren Schritte mehr nötig.</p>`
        : `<p>you have completed KYC and are now provisionally verified. No further steps are necessary from your side.</p>`;
    const title = language === 'de' ? 'Identifikation abgeschlossen' : 'Identification complete';
    await this.sendMailInternal(mail, `Hi ${firstName}`, title, htmlBody);
  }

  async sendOnlineFailedMail(firstName: string, mail: string, language: string, url: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>deine Online Identifikation ist fehlgeschlagen.</p>
    <p>Wir haben für dich Video Idenfikation aktiviert. Zum Starten klicke KYC fortsetzen auf der Payment-Seite (Kaufen & Verkaufen) oder <a href="${url}">hier</a>.</p>`
        : `<p>your online identification failed.</p>
      <p>We activated video identification. To start you have to click continue KYC on payment page (Buy & Sell) or <a href="${url}">here</a>.</p>`;
    const title = language === 'de' ? 'Online Identifikation fehlgeschlagen' : 'Online identification failed';
    await this.sendMailInternal(mail, `Hi ${firstName}`, title, htmlBody);
  }

  async sendKycFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
    const htmlSupportBody = `
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

    await this.sendMailInternal(this.supportMail, 'Hi DFX Support', 'KYC failed or expired', htmlSupportBody);
  }

  async sendErrorMail(subject: string, errors: string[]): Promise<void> {
    const env = Config.environment.toUpperCase();

    const htmlBody = `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;

    await this.sendMailInternal(this.monitoringMail, 'Hi DFX Tech Support', `${subject} (${env})`, htmlBody);
  }

  async sendMailInternal(
    to: string,
    salutation: string,
    subject: string,
    body: string,
    from?: string,
    bcc?: string,
    cc?: string,
    displayName?: string,
  ) {
    try {
      await this.sendMail(to, salutation, subject, body, from, bcc, cc, displayName);
    } catch (e) {
      console.error(`Exception during send mail: from:${from}, to:${to}, subject:${subject}:`, e);
    }
  }

  async sendMail(
    to: string,
    salutation: string,
    subject: string,
    body: string,
    from?: string,
    bcc?: string,
    cc?: string,
    displayName?: string,
    template?: string,
    telegramUrl?: string,
    twitterUrl?: string,
    linkedinUrl?: string,
    instagramUrl?: string,
  ) {
    await this.sendChatbotCompleteMail(to, 'de', 'hallo.com');
    await Util.retry(
      () =>
        this.mailerService.sendMail({
          from: { name: displayName ?? 'DFX.swiss', address: from ?? this.noReplyMail },
          to: to,
          cc: cc,
          bcc: bcc,
          template: template ?? Config.defaultMailTemplate,
          context: {
            salutation: salutation,
            body: body,
            date: new Date().getFullYear(),
            telegramUrl: telegramUrl ?? Config.defaultTelegramUrl,
            twitterUrl: twitterUrl ?? Config.defaultTwitterUrl,
            linkedinUrl: linkedinUrl ?? Config.defaultLinkedinUrl,
            instagramUrl: instagramUrl ?? Config.defaultInstagramUrl,
          },
          subject: subject,
        }),
      3,
      1000,
    );
  }
}
