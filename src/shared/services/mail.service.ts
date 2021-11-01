import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CreateLogDto } from 'src/user/models/log/dto/create-log.dto';
import { ConversionService } from 'src/shared/services/conversion.service';
import { KycStatus, UserData } from 'src/user/models/userData/userData.entity';

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

    const htmlBody = `<p>Hi ${firstName},</p>
      <p><b>Your transaction has been successful.</b></p>
      <p><b>Bank transfer: </b>${fiatValue} ${fiatName}</p>
      <p><b>Asset received: </b>${assetValue} ${assetName}</p>
      <p><b>Exchange rate: </b>${exchangeRate} ${fiatName}/${assetName}</p>
      <p><b>Txid:</b> ${createLogDto.blockchainTx}</p>
      <p>Thanks,</p>
      <p>Your friendly team at DFX</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;
    await this.mailerService.sendMail({
      to: createLogDto.user.mail,
      subject: subject,
      html: htmlBody,
    });
  }

  async sendKycMail(userData: UserData, firstName: string, mail: string, kycCustomerId: number): Promise<void> {
    const htmlSupportBody = `
      <h1>Hi DFX Support</h1>
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
      <p>Best,</p>
      <p>DFX API</p>
      <p>© 2021 DFX AG</p>
    `;

    await this.mailerService.sendMail({
      to: this.supportMail,
      subject: 'New KYC onboarding',
      html: htmlSupportBody,
    });

    const htmlUserBody = `
    <h1>Hi ${firstName},</h1>
    <p>your KYC process is complete and will be checked manually.</p>
    <p>You can now transfer 45 000€ per year.</p>
    <p></p>
    <p>Thanks,</p>
    <p>Your friendly team at DFX</p>
    <p></p>
    <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
    <p>2021 DFX AG</p>`;

    await this.mailerService.sendMail({
      to: mail,
      subject: 'KYC process is complete',
      html: htmlUserBody,
    });
  }

  async sendReminderMail(firstName: string, mail: string, kycStatus: KycStatus): Promise<void> {
    const htmlBody = `
      <h1>Hi ${firstName},</h1>
      <p>friendly reminder of your ${this.getStatus(kycStatus)}.</p>
      <p>Please check your mails.</p>
      <p></p>
      <p>Thanks,</p>
      <p>Your friendly team at DFX</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;

    await this.mailerService.sendMail({
      to: mail,
      subject: `KYC Reminder`,
      html: htmlBody,
    });
  }

  async sendSupportFailedMail(userData: UserData, kycCustomerId: number): Promise<void> {
    const htmlSupportBody = `
      <h1>Hi DFX Support</h1>
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
      <p>Best,</p>
      <p>DFX API</p>
      <p>© 2021 DFX AG</p>
    `;

    await this.mailerService.sendMail({
      to: this.supportMail,
      subject: 'KYC failed or expired',
      html: htmlSupportBody,
    });
  }

  async sendLimitSupportMail(userData: UserData, kycCustomerId: number, depositLimit: string): Promise<void> {
    const htmlSupportBody = `
      <h1>Hi DFX Support</h1>
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
      <p>Best,</p>
      <p>DFX API</p>
      <p>© 2021 DFX AG</p>
    `;

    await this.mailerService.sendMail({
      to: this.supportMail,
      subject: 'Increase deposit limit',
      html: htmlSupportBody,
    });
  }

  async sendNodeErrorMail(errors: string[]): Promise<void> {
    const env = process.env.ENVIRONMENT.toUpperCase();
    const htmlBody = `
    <h1>Hi DFX Tech Support</h1>
    <p>there seem to be some problems with the DeFiChain nodes on ${env}:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    <p>Best,</p>
    <p>DFX API</p>
    <p>© 2021 DFX AG</p>
    `;

    await this.mailerService.sendMail({
      to: this.techMail,
      subject: `Node Error (${env})`,
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
      case KycStatus.WAIT_ONLINE_ID: {
        status = 'online identification';
        break;
      }
      case KycStatus.WAIT_VIDEO_ID: {
        status = 'video identification';
        break;
      }
    }
    return status;
  }
}
