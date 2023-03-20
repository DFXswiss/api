import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserDataRepository } from './user-data.repository';
import { KycCompleted, KycInProgress, KycState, KycType, UserData, UserDataStatus } from './user-data.entity';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CountryService } from 'src/shared/models/country/country.service';
import { getRepository, MoreThan, Not } from 'typeorm';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { LanguageService } from 'src/shared/models/language/language.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Config } from 'src/config/config';
import { ReferenceType, SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { UserRepository } from '../user/user.repository';
import { SpiderApiService } from 'src/subdomains/generic/user/services/spider/spider-api.service';
import { Util } from 'src/shared/utils/util';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KycProcessService } from '../kyc/kyc-process.service';
import { BankTx } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.entity';
import { WebhookService } from '../../services/webhook/webhook.service';
import { AccountType } from './account-type.enum';
import { KycUserDataDto } from '../kyc/dto/kyc-user-data.dto';
import { LinkService } from '../link/link.service';

@Injectable()
export class UserDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
    private readonly kycProcessService: KycProcessService,
    private readonly webhookService: WebhookService,
    @Inject(forwardRef(() => LinkService)) private readonly linkService: LinkService,
  ) {}

  async getUserDataByUser(userId: number): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .leftJoinAndSelect('userData.users', 'user')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('user.wallet', 'wallet')
      .where('user.id = :id', { id: userId })
      .getOne();
  }

  async getUserData(userDataId: number): Promise<UserData> {
    return this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['users'] });
  }

  async getUserDataByKycHash(kycHash: string): Promise<UserData | undefined> {
    return this.userDataRepo.findOne({ kycHash });
  }

  async getUsersByMail(mail: string): Promise<UserData[]> {
    return this.userDataRepo.find({
      where: { mail: mail },
      relations: ['users'],
    });
  }

  async getUserDataByKey(key: string, value: any): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .select('userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`userData.${key} = :param`, { param: value })
      .andWhere(`userData.status != :status`, { status: UserDataStatus.MERGED })
      .getOne();
  }

  async createUserData(kycType: KycType): Promise<UserData> {
    const userData = await this.userDataRepo.save({
      language: await this.languageService.getLanguageBySymbol(Config.defaultLanguage),
      currency: await this.fiatService.getFiatByName(Config.defaultCurrency),
      kycType: kycType,
    });

    return userData;
  }

  async updateUserData(userDataId: number, dto: UpdateUserDataDto): Promise<UserData> {
    let userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['users', 'users.wallet'] });
    if (!userData) throw new NotFoundException('User data not found');

    userData = await this.updateSpiderIfNeeded(userData, dto);

    if (dto.countryId) {
      userData.country = await this.countryService.getCountry(dto.countryId);
      if (!userData.country) throw new BadRequestException('Country not found');
    }

    if (dto.nationality) {
      userData.nationality = await this.countryService.getCountry(dto.nationality.id);
      if (!userData.nationality) throw new BadRequestException('Nationality not found');
    }

    if (dto.organizationCountryId) {
      userData.organizationCountry = await this.countryService.getCountry(dto.organizationCountryId);
      if (!userData.organizationCountry) throw new BadRequestException('Country not found');
    }

    if (dto.mainBankDataId) {
      userData.mainBankData = await this.bankDataRepo.findOne(dto.mainBankDataId);
      if (!userData.mainBankData) throw new BadRequestException('Bank data not found');
    }

    if (dto.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOne({
        where: { id: Not(userDataId), kycFileId: dto.kycFileId },
      });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');

      await this.userDataRepo.save({ ...userData, ...{ kycFileId: dto.kycFileId } });

      const customerInfo = await this.spiderApiService.getCustomerInfo(userDataId);
      if (customerInfo?.contractReference == null) throw new BadRequestException('Spider KYC file reference is null');

      if (customerInfo.contractReference !== dto.kycFileId.toString())
        await this.spiderService.renameReference(
          customerInfo.contractReference,
          dto.kycFileId.toString(),
          ReferenceType.CONTRACT,
        );
    }

    if (dto.kycStatus && userData.kycStatus != dto.kycStatus) {
      userData = await this.kycProcessService.goToStatus(userData, dto.kycStatus);
    }

    return this.userDataRepo.save({ ...userData, ...dto });
  }

  async updateKycData(user: UserData, data: KycUserDataDto): Promise<UserData> {
    const isPersonalAccount = (data.accountType ?? user.accountType) === AccountType.PERSONAL;

    // check countries
    const [country, organizationCountry] = await Promise.all([
      this.countryService.getCountry(data.country?.id ?? user.country?.id),
      this.countryService.getCountry(data.organizationCountry?.id ?? user.organizationCountry?.id),
    ]);
    if (!country || (!isPersonalAccount && !organizationCountry)) throw new BadRequestException('Country not found');
    if (!country.isEnabled(user.kycType) || (!isPersonalAccount && !organizationCountry.isEnabled(user.kycType)))
      throw new BadRequestException(`Country not allowed for ${user.kycType}`);

    if (isPersonalAccount) {
      data.organizationName = null;
      data.organizationStreet = null;
      data.organizationHouseNumber = null;
      data.organizationLocation = null;
      data.organizationZip = null;
      data.organizationCountry = null;
    }

    user = await this.updateSpiderIfNeeded(user, data);

    return this.userDataRepo.save(Object.assign(user, data));
  }

  async updateUserSettings(user: UserData, dto: UpdateUserDto): Promise<{ user: UserData; isKnownUser: boolean }> {
    // check language
    if (dto.language) {
      dto.language = await this.languageService.getLanguage(dto.language.id);
      if (!dto.language) throw new BadRequestException('Language not found');
    }

    // check currency
    if (dto.currency) {
      dto.currency = await this.fiatService.getFiat(dto.currency.id);
      if (!dto.currency) throw new BadRequestException('Currency not found');
    }

    const mailChanged = dto.mail && dto.mail !== user.mail;

    // update spider
    user = await this.updateSpiderIfNeeded(user, dto);

    user = await this.userDataRepo.save(Object.assign(user, dto));

    const isKnownUser = mailChanged && (await this.isKnownKycUser(user));
    return { user, isKnownUser };
  }

  private async updateSpiderIfNeeded(userData: UserData, dto: UpdateUserDto): Promise<UserData> {
    if ((dto.phone && dto.phone != userData.phone) || (dto.mail && dto.mail != userData.mail)) {
      await this.spiderService.updateCustomer(userData.id, {
        telephones: dto.phone ? [dto.phone.replace('+', '').split(' ').join('')] : undefined,
        emails: dto.mail ? [dto.mail] : undefined,
      });

      if (KycInProgress(userData.kycStatus)) {
        userData.kycState = KycState.FAILED;
      }
    }

    return userData;
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.userDataRepo.update({ annualBuyVolume: Not(0) }, { annualBuyVolume: 0 });
    await this.userDataRepo.update({ annualSellVolume: Not(0) }, { annualSellVolume: 0 });
  }

  async updateVolumes(userDataId: number): Promise<void> {
    const volumes = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyVolume)', 'buyVolume')
      .addSelect('SUM(annualBuyVolume)', 'annualBuyVolume')
      .addSelect('SUM(sellVolume)', 'sellVolume')
      .addSelect('SUM(annualSellVolume)', 'annualSellVolume')
      .addSelect('SUM(cryptoVolume)', 'cryptoVolume')
      .addSelect('SUM(annualCryptoVolume)', 'annualCryptoVolume')
      .where('userDataId = :id', { id: userDataId })
      .getRawOne<{
        buyVolume: number;
        annualBuyVolume: number;
        sellVolume: number;
        annualSellVolume: number;
        cryptoVolume: number;
        annualCryptoVolume: number;
      }>();

    await this.userDataRepo.update(userDataId, {
      buyVolume: Util.round(volumes.buyVolume, Config.defaultVolumeDecimal),
      annualBuyVolume: Util.round(volumes.annualBuyVolume, Config.defaultVolumeDecimal),
      sellVolume: Util.round(volumes.sellVolume, Config.defaultVolumeDecimal),
      annualSellVolume: Util.round(volumes.annualSellVolume, Config.defaultVolumeDecimal),
      cryptoVolume: Util.round(volumes.cryptoVolume, Config.defaultVolumeDecimal),
      annualCryptoVolume: Util.round(volumes.annualCryptoVolume, Config.defaultVolumeDecimal),
    });
  }

  async isKnownKycUser(user: UserData): Promise<boolean> {
    if (user.isDfxUser) {
      const users = await this.getUsersByMail(user.mail);
      const completedUser = users.find((u) => u.id !== user.id && KycCompleted(u.kycStatus) && u.isDfxUser);
      if (completedUser) {
        // send an address link request
        await this.linkService.createNewLinkAddress(user, completedUser);
        return true;
      }
    }

    return false;
  }

  async mergeUserData(masterId: number, slaveId: number): Promise<void> {
    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({
        where: { id: masterId },
        relations: ['users', 'users.wallet', 'bankDatas', 'bankAccounts'],
      }),
      this.userDataRepo.findOne({
        where: { id: slaveId },
        relations: ['users', 'users.wallet', 'bankDatas', 'bankAccounts'],
      }),
    ]);
    if (!master.isDfxUser) throw new BadRequestException(`Master ${master.id} not allowed to merge. Wrong KYC type`);

    const bankAccountsToReassign = slave.bankAccounts.filter(
      (sba) => !master.bankAccounts.some((mba) => sba.iban === mba.iban),
    );

    console.log(
      `Merging user ${master.id} (master) and ${slave.id} (slave): reassigning `,
      [
        bankAccountsToReassign.length > 0 && `bank accounts ${bankAccountsToReassign.map((ba) => ba.id).join(', ')}`,
        slave.bankDatas.length > 0 && `bank datas ${slave.bankDatas.map((b) => b.id).join(', ')}`,
        slave.users.length > 0 && `users ${slave.users.map((u) => u.id).join(', ')}`,
      ]
        .filter((i) => i)
        .join(' and '),
    );

    await this.updateBankTxTime(slave.id);

    // reassign bank accounts, datas and users
    master.bankAccounts = master.bankAccounts.concat(bankAccountsToReassign);
    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    await this.userDataRepo.save(master);

    // update slave status
    await this.userDataRepo.update(slave.id, { status: UserDataStatus.MERGED });

    // KYC change Webhook
    await this.webhookService.kycChanged(master);

    // update volumes
    await this.updateVolumes(masterId);
    await this.updateVolumes(slaveId);

    // activate users
    if (master.hasActiveUser) {
      await this.userDataRepo.activateUserData(master);

      for (const user of master.users) {
        await this.userRepo.activateUser(user);
      }
    }
  }

  async getAllUserDataWithEmptyFileId(): Promise<number[]> {
    const userDataList = await this.userDataRepo.find({ where: { kycFileId: MoreThan(0) } });
    const idList = [];
    for (const userData of userDataList) {
      const customerInfo = await this.spiderApiService.getCustomerInfo(userData.id);
      if (customerInfo && !customerInfo.contractReference) idList.push(userData.id);
    }

    return idList;
  }

  private async updateBankTxTime(userDataId: number): Promise<void> {
    const txList = await getRepository(BankTx).find({
      select: ['id'],
      where: [
        { buyCrypto: { buy: { user: { userData: { id: userDataId } } } } },
        { buyFiat: { sell: { user: { userData: { id: userDataId } } } } },
      ],
      relations: [
        'buyCrypto',
        'buyCrypto.buy',
        'buyCrypto.buy.user',
        'buyCrypto.buy.user.userData',
        'buyFiat',
        'buyFiat.sell',
        'buyFiat.sell.user',
        'buyFiat.sell.user.userData',
      ],
    });

    if (txList.length != 0)
      await getRepository(BankTx).update(
        txList.map((tx) => tx.id),
        { updated: new Date() },
      );
  }
}
