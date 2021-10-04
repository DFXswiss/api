import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { CreateLogDto } from 'src/log/dto/create-log.dto';
import { ConversionService } from 'src/shared/services/conversion.service';
import { UserData } from 'src/userData/userData.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';

// TODO(david): move to shared
@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';

  constructor(
    private mailerService: MailerService,
    private conversionService: ConversionService,
    private assetService: AssetService,
    private fiatService: FiatService,
  ) {}

  async sendLogMail(createLogDto: CreateLogDto, subject: string) {
    const firstName = createLogDto.user.firstname ?? 'DFX Dude';
    const fiat = (await this.fiatService.getFiat(createLogDto.fiat)).name;
    const asset = (await this.assetService.getAsset(createLogDto.asset)).name;

    const fiatValue = this.conversionService.round(createLogDto.fiatValue, 2);
    const assetValue = this.conversionService.round(createLogDto.assetValue, 8);
    const exchangeRate = this.conversionService.round(createLogDto.fiatValue / createLogDto.assetValue, 2);

    const htmlBody = `<p>Hi ${firstName},</p>
      <p><b>Your transaction has been successful.</b></p>
      <p><b>Bank transfer: </b>${fiatValue} ${fiat}</p>
      <p><b>Asset received: </b>${assetValue} ${asset}</p>
      <p><b>Exchange rate: </b>${exchangeRate} ${fiat}/${asset}</p>
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
