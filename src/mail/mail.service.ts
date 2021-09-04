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
    if (firstName === '') firstName = 'Dude';
    const htmlBody =
      '<p>Hey ' +
      firstName +
      ',</p><p>great news: Your' +
      (await this.assetRepository.getAsset(createLogDto.asset)).name +
      'are on the way!</p><p>The DeFiChain Transaktion ID is: 1234</p><p>Stay tuned</p><p></p><p><img src="https://defichain-wiki.com/thumb.php?f=DFX_600px.png&width=400"></p>';
    await this.mailerService.sendMail({
      to: createLogDto.user.mail,
      subject: subject,
      html: htmlBody,
    });
  }
}
