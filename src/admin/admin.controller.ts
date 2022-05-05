import { Controller, Post, UseGuards, Body, Get, Query, BadRequestException, Put } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { BuyCrypto } from 'src/payment/models/buy-crypto/buy-crypto.entity';
import { BuyCryptoService } from 'src/payment/models/buy-crypto/buy-crypto.service';
import { CryptoSell } from 'src/payment/models/crypto-sell/crypto-sell.entity';
import { CryptoSellService } from 'src/payment/models/crypto-sell/crypto-sell.service';
import { CryptoStaking } from 'src/payment/models/crypto-staking/crypto-staking.entity';
import { CryptoStakingService } from 'src/payment/models/crypto-staking/crypto-staking.service';
import { RefReward } from 'src/payment/models/ref-reward/ref-reward.entity';
import { RefRewardService } from 'src/payment/models/ref-reward/ref-reward.service';
import { StakingReward } from 'src/payment/models/staking-reward/staking-reward.entity';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LetterService } from 'src/shared/services/letter.service';
import { MailService } from 'src/shared/services/mail.service';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { Customer } from 'src/user/services/spider/dto/spider.dto';
import { SpiderApiService } from 'src/user/services/spider/spider-api.service';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { getConnection } from 'typeorm';
import { RenameRefDto } from './dto/rename-ref.dto';
import { SendLetterDto } from './dto/send-letter.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { UploadFileDto } from './dto/upload-file.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly mailService: MailService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
    private readonly letterService: LetterService,
    private readonly userDataService: UserDataService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly cryptoSellService: CryptoSellService,
    private readonly cryptoStakingService: CryptoStakingService,
    private readonly refRewardService: RefRewardService,
    private readonly stakingRewardService: StakingRewardService,
  ) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() dtoList: SendMailDto[]): Promise<void> {
    for (const dto of dtoList) {
      await this.mailService.sendMail(dto);
    }
  }

  @Put('renameSpiderRef')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async renameReference(@Body() renameRefDto: RenameRefDto): Promise<boolean> {
    return await this.spiderService.renameReference(
      renameRefDto.oldReference,
      renameRefDto.newReference,
      renameRefDto.referenceType,
    );
  }

  @Get('spider')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSpiderData(@Query('min') min: number, @Query('max') max: number): Promise<Customer[]> {
    const customerList = [];
    for (let id = min; id <= max; id++) {
      customerList.push(await this.spiderApiService.getCustomer(id));
    }
    return customerList;
  }

  @Post('upload')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async uploadFile(@Body() uploadFileDto: UploadFileDto): Promise<boolean> {
    return await this.spiderService.uploadDocument(
      uploadFileDto.userDataId,
      false,
      uploadFileDto.documentType,
      uploadFileDto.originalName,
      uploadFileDto.contentType,
      Buffer.from(uploadFileDto.data, 'base64'),
    );
  }

  @Post('sendLetter')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendLetter(@Body() sendLetterDto: SendLetterDto): Promise<boolean> {
    return await this.letterService.sendLetter(sendLetterDto);
  }

  @Get('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawData(
    @Query() { table, min, updatedSince }: { table: string; min?: string; updatedSince?: string },
  ): Promise<any> {
    const id = min ? +min : 1;
    const updated = updatedSince ? new Date(updatedSince) : new Date(0);

    const data = await getConnection()
      .createQueryBuilder()
      .from(table, table)
      .where('id >= :id', { id })
      .andWhere('updated >= :updated', { updated })
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    // transform to array
    const arrayData =
      data.length > 0
        ? {
            keys: Object.keys(data[0]),
            values: data.map((e) => Object.values(e)),
          }
        : undefined;

    // workarounds for GS's
    if (arrayData) {
      switch (table) {
        case 'buy':
          const userTable = await getConnection().createQueryBuilder().from('user', 'user').getRawMany();

          const userIdIndex = arrayData.keys.findIndex((k) => k === 'userId');

          // insert user address at position 2
          arrayData.keys.splice(1, 0, 'address');
          for (const buy of arrayData.values) {
            buy.splice(1, 0, userTable.find((u) => u.id === buy[userIdIndex]).address);
          }
          break;
      }
    }

    return arrayData;
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSupportData(@Query('id') id: string): Promise<{
    buy: BuyCrypto[];
    sell: CryptoSell[];
    ref: BuyCrypto[];
    refReward: RefReward[];
    staking: CryptoStaking[];
    stakingReward: StakingReward[];
  }> {
    const userData = await this.userDataService.getUserData(+id);
    const userIds = userData.users.map((u) => u.id);
    const refCodes = userData.users.map((u) => u.ref);

    return {
      buy: await this.buyCryptoService.getUserTransactions(userIds),
      sell: await this.cryptoSellService.getUserTransactions(userIds),
      ref: await this.buyCryptoService.getRefTransactions(refCodes),
      refReward: await this.refRewardService.getUserRewards(userIds),
      staking: await this.cryptoStakingService.getUserTransactions(userIds),
      stakingReward: await this.stakingRewardService.getUserRewards(userIds),
    };
  }
}
