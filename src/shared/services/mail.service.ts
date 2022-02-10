import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { Config } from 'src/config/config';

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';
  private readonly techMail = 'cto@dfx.swiss';
  private readonly noReplyMail = 'noreply@dfx.swiss';
  private readonly kycStatus = {
    [KycStatus.CHATBOT]: 'Chatbot',
    [KycStatus.ONLINE_ID]: 'Online ID',
    [KycStatus.VIDEO_ID]: 'Video ID',
  };

  constructor(private mailerService: MailerService) {}

  async sendKycReminderMail(
    firstName: string,
    mail: string,
    kycStatus: KycStatus,
    language: string,
    url: string,
  ): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>freundliche Erinnerung an dein ${this.kycStatus[kycStatus]}.</p>
    <p>Um fortzufahren, klicke KYC fortsetzen auf der Payment-Seite (Kaufen & Verkaufen) oder <a href="${url}">hier</a>.</p>`
        : `<p>friendly reminder of your ${this.kycStatus[kycStatus]}.</p>
      <p>Please continue by clicking on continue KYC on payment page (Buy & Sell) or <a href="${url}">here</a>.</p>`;

    await this.sendMail(mail, `Hi ${firstName}`, 'KYC Reminder', htmlBody);
  }

  async sendChatbotCompleteMail(firstName: string, mail: string, language: string, url: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>du hast den Chatbot abgeschlossen.</p>
    <p>Um die Identifikation zu starten, klicke KYC fortsetzen auf der Payment-Seite (Kaufen & Verkaufen) oder <a href="${url}">hier</a>.</p>`
        : `<p>you have finished the first step of your verification.</p>
      <p>To continue with identification you have to click continue KYC on payment page (Buy & Sell) or <a href="${url}">here</a>.</p>`;
    const title = language === 'de' ? 'Chatbot abgeschlossen' : 'Chatbot complete';
    await this.sendMail(mail, `Hi ${firstName}`, title, htmlBody);
  }

  async sendIdentificationCompleteMail(firstName: string, mail: string, language: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>du hast KYC abgeschlossen und bist nun provisorisch verifiziert. Von deiner Seite sind keine weiteren Schritte mehr nötig.</p>`
        : `<p>you have completed KYC and are now provisionally verified. No further steps are necessary from your side.</p>`;
    const title = language === 'de' ? 'Identifikation abgeschlossen' : 'Identification complete';
    await this.sendMail(mail, `Hi ${firstName}`, title, htmlBody);
  }

  async sendOnlineFailedMail(firstName: string, mail: string, language: string, url: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>deine Online Identifikation ist fehlgeschlagen.</p>
    <p>Wir haben für dich Video Idenfikation aktiviert. Zum Starten klicke KYC fortsetzen auf der Payment-Seite (Kaufen & Verkaufen) oder <a href="${url}">hier</a>.</p>`
        : `<p>your online identification failed.</p>
      <p>We activated video identification. To start you have to click continue KYC on payment page (Buy & Sell) or <a href="${url}">here</a>.</p>`;
    const title = language === 'de' ? 'Online Identifikation fehlgeschlagen' : 'Online identification failed';
    await this.sendMail(mail, `Hi ${firstName}`, title, htmlBody);
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

    await this.sendMail(this.supportMail, 'Hi DFX Support', 'KYC failed or expired', htmlSupportBody);
  }

  async sendErrorMail(subject: string, errors: string[]): Promise<void> {
    const env = Config.environment.toUpperCase();

    const htmlBody = `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;

    await this.sendMail(this.techMail, 'Hi DFX Tech Support', `${subject} (${env})`, htmlBody);
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
  ) {
    const htmlBody = `<h1>${salutation}</h1>
      <p>${body}</p>
      <p></p>
      <p>Thanks,</p>
      <p>Your DFX team</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>${new Date().getFullYear()} DFX AG</p>`;
    try {
      await this.mailerService.sendMail({
        from: { name: displayName ?? 'DFX.swiss', address: from ?? this.noReplyMail },
        to: to,
        cc: cc,
        bcc: bcc,
        subject: subject,
        html: htmlBody,
      });
    } catch (e) {
      console.error(`Exception during send mail: from:${from}, to:${to}, subject:${subject}. Error:`, e);
    }
  }
}
