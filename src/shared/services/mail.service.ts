import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CreateLogDto } from 'src/user/models/log/dto/create-log.dto';
import { KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { LogDirection } from 'src/user/models/log/log.entity';
import { Util } from '../util';
import { Config } from 'src/config/config';

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';
  private readonly techMail = 'cto@dfx.swiss';
  private readonly kycStatus = {
    [KycStatus.WAIT_CHAT_BOT]: 'chatbot onboarding',
    [KycStatus.WAIT_ADDRESS]: 'invoice upload',
    [KycStatus.WAIT_ONLINE_ID]: 'online identification',
    [KycStatus.WAIT_VIDEO_ID]: 'video identification',
  };

  constructor(private mailerService: MailerService) {}

  // TODO: add fiat/asset object to createLogDto?
  async sendLogMail(createLogDto: CreateLogDto, subject: string, fiatName: string, assetName: string) {
    const firstName = createLogDto.user.firstname ?? 'DFX Dude';

    const fiatValue = Util.round(createLogDto.fiatValue, 2);
    const assetValue = Util.round(createLogDto.assetValue, 8);
    const exchangeRate = Util.round(createLogDto.fiatValue / createLogDto.assetValue, 2);

    let htmlBody;
    if (createLogDto.direction === LogDirection.fiat2asset) {
      htmlBody = `<p><b>Your transaction has been successful.</b></p>
        <p><b>Bank deposit: </b>${fiatValue} ${fiatName}</p>
        <p><b>Asset received: </b>${assetValue} ${assetName}</p>
        <p><b>Exchange rate: </b>${exchangeRate} ${fiatName}/${assetName}</p>
        <p><b>Txid:</b> ${createLogDto.blockchainTx}</p>`;
    } else if (createLogDto.direction === LogDirection.asset2fiat) {
      htmlBody = `<p><b>Your transaction has been successful.</b></p>
        <p><b>Asset withdrawal: </b>${assetValue} ${assetName}</p>
        <p><b>Bank transfer: </b>${fiatValue} ${fiatName}</p>
        <p><b>Exchange rate: </b>${exchangeRate} ${fiatName}/${assetName}</p>`;
    }

    await this.sendMail(createLogDto.user.mail, `Hi ${firstName}`, subject, htmlBody);
  }

  async sendReminderMail(firstName: string, mail: string, kycStatus: KycStatus): Promise<void> {
    const htmlBody = `<p>friendly reminder of your ${this.kycStatus[kycStatus]}.</p>
      <p>Please check your mails.</p>`;

    await this.sendMail(mail, `Hi ${firstName}`, 'KYC Reminder', htmlBody);
  }

  async sendChatBotMail(firstName: string, mail: string, language: string): Promise<void> {
    const htmlBody =
      language === 'de'
        ? `<p>du hast den Chatbot abgeschlossen.</p>
    <p>Um die Online Identifikation zu starten, klicke KYC fortsetzen auf der Payment Seite. (Kaufen & Verkaufen)</p>`
        : `<p>you have finished the first step of your verification.</p>
      <p>To continue with online identification you have to click continue KYC on payment page. (Buy & Sell)</p>`;

    await this.sendMail(mail, `Hi ${firstName}`, 'Finished Chatbot', htmlBody);
  }

  async sendSupportFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
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

  async sendLimitSupportMail(userData: UserData, kycCustomerId: number, depositLimit: string): Promise<void> {
    const htmlSupportBody = `
      <p>a customer want to increase his deposit limit.</p>
      <table>
          <tr>
              <td>Reference:</td>
              <td>${userData.id}</td>
          </tr>
          <tr>
              <td>Customer ID:</td>
              <td>${kycCustomerId}</td>
          </tr>
          <tr>
              <td>KYC File Reference:</td>
              <td>${userData.kycFileId}</td>
          </tr>
          <tr>
              <td>Wanted deposit limit:</td>
              <td>${depositLimit}</td>
          </tr>
      </table>
    `;

    await this.sendMail(this.supportMail, 'Hi DFX Support', 'Increase deposit limit', htmlSupportBody);
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

  async sendMail(recipient: string, salutation: string, subject: string, body: string) {
    const htmlBody = `<h1>${salutation}</h1>
      <p>${body}</p>
      <p></p>
      <p>Thanks,</p>
      <p>Your DFX team</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;

    await this.mailerService.sendMail({
      to: recipient,
      subject: subject,
      html: htmlBody,
    });
  }
}
