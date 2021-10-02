import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { AssetRepository } from 'src/asset/asset.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { CreateLogDto } from 'src/log/dto/create-log.dto';
import { UserData } from 'src/userData/userData.entity';
import { CheckVersion } from './kyc.service';

@Injectable()
export class MailService {
  private readonly supportMail = 'support@dfx.swiss';

  constructor(
    private mailerService: MailerService,
    private assetRepository: AssetRepository,
    private fiatRepository: FiatRepository,
  ) {}

  async sendLogMail(createLogDto: CreateLogDto, subject: string) {
    const firstName = createLogDto.user.firstname ?? 'DFX Dude';
    const htmlBody = `<p>Hi ${firstName},</p>
      <p><b>Your transaction has been successful.</b></p>
      <p><b>Bank transfer: </b>${Math.round(createLogDto.fiatValue * Math.pow(10, 2)) / Math.pow(10, 2)} ${
      (await this.fiatRepository.getFiat(createLogDto.fiat)).name
    }
    <p><b>Asset received: </b>${Math.round(createLogDto.assetValue * Math.pow(10, 8)) / Math.pow(10, 8)} 
      ${(await this.assetRepository.getAsset(createLogDto.asset)).name}
      <p><b>Exchange rate: </b>${
        Math.round((createLogDto.fiatValue / createLogDto.assetValue) * Math.pow(10, 2)) / Math.pow(10, 2)
      } 
      ${(await this.fiatRepository.getFiat(createLogDto.fiat)).name}/${
      (await this.assetRepository.getAsset(createLogDto.asset)).name
    }
    <p>
      <b>Txid:</b> ${createLogDto.blockchainTx}</p>
      <p>Thanks,</p><p> Your friendly team at DFX</p><p></p><p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>
      <p>2021 DFX AG</p>`;
    await this.mailerService.sendMail({
      to: createLogDto.user.mail,
      subject: subject,
      html: htmlBody,
    });
  }

  async sendKycRequestMail(userData: UserData, checkData: CheckVersion): Promise<void> {
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
