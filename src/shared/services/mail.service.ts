import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CreateLogDto } from 'src/user/models/log/dto/create-log.dto';
import { ConversionService } from 'src/shared/services/conversion.service';
import { UserData } from 'src/user/models/userData/userData.entity';

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';

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
      <p> Your friendly team at DFX</p>
      <p></p>
      <p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;
    await this.mailerService.sendMail({
      to: createLogDto.user.mail,
      subject: subject,
      html: htmlBody,
    });
  }

  async sendKycRequestMail(userData: UserData): Promise<void> {
    const htmlBody = `
      <h1>Hi DFX Support</h1>
      <p>a new customer has finished onboarding chatbot, address verification and online identification:</p>
      <table>
          <tr>
              <td>Reference:</td>
              <td>${userData.id}</td>
          </tr>
          <tr>
              <td>Customer ID:</td>
              <td>${userData.kycCustomerId}</td>
          </tr>
          <tr>
              <td>KYC File Reference:</td>
              <td>${userData.kycFileReference}</td>
          </tr>
      </table>
      <p>Best,</p>
      <p>DFX API</p>
      <p>© 2021 DFX AG</p>
    `;

    await this.mailerService.sendMail({
      to: this.supportMail,
      subject: 'New KYC onboarding',
      html: htmlBody,
    });
  }
}
