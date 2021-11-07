import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CreateLogDto } from 'src/user/models/log/dto/create-log.dto';
import { ConversionService } from 'src/shared/services/conversion.service';
import { KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { LogDirection } from 'src/user/models/log/log.entity';

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';
  private readonly techMail = ' cto@dfx.swiss';

  constructor(private mailerService: MailerService, private conversionService: ConversionService) {}

  // TODO: add fiat/asset object to createLogDto?
  async sendLogMail(createLogDto: CreateLogDto, subject: string, fiatName: string, assetName: string) {
    const firstName = createLogDto.user.firstname ?? 'DFX Dude';

    const fiatValue = this.conversionService.round(createLogDto.fiatValue, 2);
    const assetValue = this.conversionService.round(createLogDto.assetValue, 8);
    const exchangeRate = this.conversionService.round(createLogDto.fiatValue / createLogDto.assetValue, 2);

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

  async sendKycMail(userData: UserData, firstName: string, mail: string, kycCustomerId: number): Promise<void> {
    const htmlSupportBody = `
      <p>a new customer has finished onboarding chatbot, address verification and online identification:</p>
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
              <td>${userData.kycFile.id}</td>
          </tr>
      </table>
    `;

    await this.sendMail(this.supportMail, 'Hi DFX Support', 'New KYC onboarding', htmlSupportBody);

    const htmlUserBody = `
    <p>your KYC process is complete and will be checked manually.</p>
    <p>You can now transfer 45 000€ per year.</p>`;

    await this.sendMail(mail, `Hi ${firstName}`, 'KYC process is complete', htmlUserBody);
  }

  async sendReminderMail(firstName: string, mail: string, kycStatus: KycStatus): Promise<void> {
    const htmlBody = `<p>friendly reminder of your ${this.getStatus(kycStatus)}.</p>
      <p>Please check your mails.</p>`;

    await this.sendMail(mail, `Hi ${firstName}`, 'KYC Reminder', htmlBody);
  }

  async sendSupportFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
    const htmlSupportBody = `
    <p>a customer has failed or expired during progress ${this.getStatus(userData.kycStatus)}.</p>
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
              <td>${userData.kycFile.id}</td>
          </tr>
          <tr>
              <td>Wanted deposit limit:</td>
              <td>${depositLimit}</td>
          </tr>
      </table>
    `;

    await this.sendMail(this.supportMail, 'Hi DFX Support', 'Increase deposit limit', htmlSupportBody);
  }

  async sendNodeErrorMail(errors: string[]): Promise<void> {
    const env = process.env.ENVIRONMENT.toUpperCase();
    const htmlBody = `
    <p>there seem to be some problems with the DeFiChain nodes on ${env}:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;

    await this.sendMail(this.techMail, 'Hi DFX Tech Support', `Node Error (${env})`, htmlBody);
  }

  async sendMail(recipient: string, salutation: string, subject: string, body: string) {
    const htmlBody = `<h1>${salutation}</h1>
      <p>${body}</p>
      <p></p>
      <p>Thanks,</p>
      <p>Your friendly team at DFX</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;

    await this.mailerService.sendMail({
      to: recipient,
      subject: subject,
      html: htmlBody,
    });
  }

  private getStatus(kycStatus: KycStatus): string {
    let status = '';
    switch (kycStatus) {
      case KycStatus.WAIT_CHAT_BOT: {
        status = 'chatbot onboarding';
        break;
      }
      case KycStatus.WAIT_ADDRESS: {
        status = 'invoice upload';
        break;
      }
      case KycStatus.WAIT_ID: {
        status = 'identification';
        break;
      }
    }
    return status;
  }
}
