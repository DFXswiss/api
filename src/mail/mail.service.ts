import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { AssetRepository } from 'src/asset/asset.repository';
import { CreateLogDto } from 'src/log/dto/create-log.dto';

@Injectable()
export class MailService {
  constructor(
    private mailerService: MailerService,
    private assetRepository: AssetRepository,
  ) {}

  async sendLogMail(createLogDto: CreateLogDto, subject: string) {
    let firstName = createLogDto.user.firstname;
    if (!firstName) firstName = 'DFX Dude';
    const htmlBody =
      '<p>Hi ' +
      firstName +
      ',</p><p><b>Your transaction is successful.</b></p><p><b>Amount: </b>' +
      createLogDto.assetValue +
      ' ' +
      (await this.assetRepository.getAsset(createLogDto.asset)).name +
      '<p><b>Txid:</b> ' +
      createLogDto.blockchainTx +
      '</p><p>Thanks,</p><p>Your friendly team at DFX</p><p></p><p><img src="https://dfx.swiss/images/Logo_DFX/png/DFX_600px.png" height="100px" width="200px"></p>' +
      '<p>© 2021 DFX AG All rights reserved.</p>';
    await this.mailerService.sendMail({
      to: createLogDto.user.mail,
      subject: subject,
      html: htmlBody,
    });
  }
}
