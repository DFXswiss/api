import {
  Controller,
  Post,
  UseGuards,
  Body,
  Get,
  Query,
  BadRequestException,
  Put,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.service';
import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoInputService } from 'src/mix/models/crypto-input/crypto-input.service';
import { CryptoStaking } from 'src/mix/models/crypto-staking/crypto-staking.entity';
import { CryptoStakingService } from 'src/mix/models/crypto-staking/crypto-staking.service';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { RefRewardService } from 'src/subdomains/core/referral/reward/ref-reward.service';
import { StakingRefReward } from 'src/mix/models/staking-ref-reward/staking-ref-reward.entity';
import { StakingRefRewardService } from 'src/mix/models/staking-ref-reward/staking-ref-reward.service';
import { StakingReward } from 'src/mix/models/staking-reward/staking-reward.entity';
import { StakingRewardService } from 'src/mix/models/staking-reward/staking-reward.service';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LetterService } from 'src/integration/letter/letter.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Customer } from 'src/subdomains/generic/user/services/spider/dto/spider.dto';
import { SpiderApiService } from 'src/subdomains/generic/user/services/spider/spider-api.service';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { getConnection } from 'typeorm';
import { dbQueryDto } from './dto/db-query.dto';
import { RenameRefDto } from './dto/rename-ref.dto';
import { SendLetterDto } from './dto/send-letter.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BankTxType } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.entity';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
    private readonly letterService: LetterService,
    private readonly userDataService: UserDataService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly cryptoStakingService: CryptoStakingService,
    private readonly refRewardService: RefRewardService,
    private readonly stakingRewardService: StakingRewardService,
    private readonly stakingRefRewardService: StakingRefRewardService,
    private readonly cryptoInputService: CryptoInputService,
  ) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() dtoList: SendMailDto[]): Promise<void> {
    for (const dto of dtoList) {
      if (dto.template === 'default') dto.template = 'user';
      await this.notificationService.sendMail({ type: MailType.GENERIC, input: dto });
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getRawData(
    @Query()
    query: dbQueryDto,
  ): Promise<any> {
    const id = query.min ? +query.min : 1;
    const maxResult = query.maxLine ? +query.maxLine : undefined;
    const updated = query.updatedSince ? new Date(query.updatedSince) : new Date(0);

    let data: any[];

    if (query.extended && query.table === 'bank_tx') {
      data = await this.getExtendedBankTxData({
        table: query.table,
        min: id,
        updatedSince: updated,
        maxLine: maxResult,
        sorting: query.sorting,
        filterCols: query.filterCols,
        extended: true,
      });
    } else {
      data = await getConnection()
        .createQueryBuilder()
        .select(query.filterCols)
        .from(query.table, query.table)
        .where('id >= :id', { id })
        .andWhere('updated >= :updated', { updated })
        .orderBy('id', query.sorting)
        .take(maxResult)
        .getRawMany()
        .catch((e: Error) => {
          throw new BadRequestException(e.message);
        });
    }

    // transform to array
    const arrayData =
      data.length > 0
        ? {
            keys: Object.keys(data[0]).map((e) => e.replace('bank_tx_', '')),
            values: data.map((e) => Object.values(e)),
          }
        : undefined;

    // workarounds for GS's
    if (arrayData) {
      switch (query.table) {
        case 'buy':
          const userTable = await getConnection().createQueryBuilder().from('user', 'user').getRawMany();

          const userIdIndex = arrayData.keys.findIndex((k) => k === 'userId');

          // insert user address at position 2
          arrayData.keys.splice(1, 0, 'address');
          for (const buy of arrayData.values) {
            buy.splice(1, 0, userTable.find((u) => u.id === buy[userIdIndex]).address);
          }
          break;

        case 'user':
          this.insertEmptyCol(arrayData, 5, [
            'mail (deactivated)',
            'firstname (deactivated)',
            'surname (deactivated)',
            'street (deactivated)',
            'houseNumber (deactivated)',
            'location (deactivated)',
            'zip (deactivated)',
            'phone (deactivated)',
          ]);

          this.insertEmptyCol(arrayData, 19, ['country (deactivated)', 'language (deactivated)']);

          this.insertEmptyCol(arrayData, 22, ['currencyId (deactivated)']);

          this.insertEmptyCol(arrayData, 24, [
            'accountType (deactivated)',
            'organizationName (deactivated)',
            'organizationStreet (deactivated)',
            'organizationHouseNumber (deactivated)',
            'organizationLocation (deactivated)',
            'organizationZip (deactivated)',
            'organizationCountryId (deactivated)',
          ]);

          break;

        case 'user_data':
          this.insertEmptyCol(arrayData, 8, ['isMigrated (deactivated)']);

          break;

        case 'buy_crypto':
          this.insertEmptyCol(arrayData, 17, ['outputAsset']);
          this.insertEmptyCol(arrayData, 15, ['outputReferenceAsset']);
          
          break;
          
        case 'bank_data':
          this.insertEmptyCol(arrayData, 2, ['location', 'country']);

          break;
      }
    }

    return arrayData;
  }

  private insertEmptyCol(
    arrayData: { keys: string[]; values: unknown[][] },
    colNumber: number,
    colNames: string[],
  ): void {
    arrayData.keys.splice(colNumber, 0, ...colNames);
    arrayData.values.forEach((v) => v.splice(colNumber, 0, ...Array(colNames.length).fill('')));
  }

  private async getExtendedBankTxData(dbQuery: dbQueryDto): Promise<any[]> {
    const select = dbQuery.filterCols
      ? dbQuery.filterCols
          .split(',')
          .map((e) => dbQuery.table + '.' + e)
          .join(',')
      : dbQuery.table;

    const buyCryptoData = await getConnection()
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyCrypto', 'buyCrypto')
      .leftJoin('buyCrypto.buy', 'buy')
      .leftJoin('buy.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('bank_tx.type = :type', { type: BankTxType.BUY_CRYPTO })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    const buyFiatData = await getConnection()
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyFiat', 'buyFiat')
      .leftJoin('buyFiat.sell', 'sell')
      .leftJoin('sell.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('bank_tx.type = :type', { type: BankTxType.BUY_FIAT })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    const bankTxRestData = await getConnection()
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyFiat', 'buyFiat')
      .leftJoin('buyFiat.sell', 'sell')
      .leftJoin('sell.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('(bank_tx.type IS NULL OR bank_tx.type NOT IN (:crypto, :fiat))', {
        crypto: BankTxType.BUY_CRYPTO,
        fiat: BankTxType.BUY_FIAT,
      })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    return buyCryptoData
      .concat(buyFiatData, bankTxRestData)
      .sort((a, b) => (dbQuery.sorting == 'ASC' ? a.bank_tx_id - b.bank_tx_id : b.bank_tx_id - a.bank_tx_id));
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getSupportData(@Query('id') id: string): Promise<{
    buyCrypto: BuyCrypto[];
    buyFiat: BuyFiat[];
    ref: BuyCrypto[];
    refReward: RefReward[];
    staking: CryptoStaking[];
    stakingReward: StakingReward[];
    stakingRefReward: StakingRefReward[];
    cryptoInput: CryptoInput[];
  }> {
    const userData = await this.userDataService.getUserData(+id);
    if (!userData) throw new NotFoundException('User data not found');

    const userIds = userData.users.map((u) => u.id);
    const refCodes = userData.users.map((u) => u.ref);

    return {
      buyCrypto: await this.buyCryptoService.getAllUserTransactions(userIds),
      buyFiat: await this.buyFiatService.getAllUserTransactions(userIds),
      ref: await this.buyCryptoService.getAllRefTransactions(refCodes),
      refReward: await this.refRewardService.getAllUserRewards(userIds),
      staking: await this.cryptoStakingService.getUserTransactions(userIds),
      stakingReward: await this.stakingRewardService.getAllUserRewards(userIds),
      stakingRefReward: await this.stakingRefRewardService.getAllUserRewards(userIds),
      cryptoInput: await this.cryptoInputService.getAllUserTransactions(userIds),
    };
  }
}
