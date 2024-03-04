import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { MergedDto } from 'src/subdomains/generic/kyc/dto/output/kyc-merged.dto';
import { KycStepName, KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycNotificationService } from 'src/subdomains/generic/kyc/services/kyc-notification.service';
import { MultiAccountIbanService } from 'src/subdomains/supporting/bank/multi-account-iban/multi-account-iban.service';
import { FindOptionsRelations, In, IsNull, Not } from 'typeorm';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { KycUserDataDto } from '../kyc/dto/kyc-user-data.dto';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { UserNameDto } from '../user/dto/user-name.dto';
import { UserRepository } from '../user/user.repository';
import { AccountType } from './account-type.enum';
import { CreateUserDataDto } from './dto/create-user-data.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserDataNotificationService } from './user-data-notification.service';
import { KycLevel, KycStatus, UserData, UserDataStatus } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';

export const MergedPrefix = 'Merged into ';

@Injectable()
export class UserDataService {
  private readonly logger = new DfxLogger(UserDataService);

  constructor(
    private readonly repos: RepositoryFactory,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly settingService: SettingService,
    private readonly kycNotificationService: KycNotificationService,
    private readonly kycAdminService: KycAdminService,
    private readonly userDataNotificationService: UserDataNotificationService,
    @Inject(forwardRef(() => AccountMergeService)) private readonly mergeService: AccountMergeService,
    private readonly multiAccountIbanService: MultiAccountIbanService,
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

  async getUserData(userDataId: number, relations?: FindOptionsRelations<UserData>): Promise<UserData> {
    return this.userDataRepo.findOne({ where: { id: userDataId }, relations });
  }

  async getByKycHashOrThrow(kycHash: string, relations?: FindOptionsRelations<UserData>): Promise<UserData> {
    let user = await this.userDataRepo.findOne({ where: { kycHash }, relations });
    if (!user) throw new NotFoundException('User not found');

    if (user.status === UserDataStatus.MERGED) {
      user = await this.getMasterUser(user);
      if (user) {
        const payload: MergedDto = {
          error: 'Unauthorized',
          message: 'User is merged',
          statusCode: 401,
          switchToCode: user.kycHash,
        };
        throw new UnauthorizedException(payload);
      } else {
        throw new BadRequestException('User is merged');
      }
    }

    return user;
  }

  private async getMasterUser(user: UserData): Promise<UserData | undefined> {
    const masterUserId = +user.firstname.replace(MergedPrefix, '');
    if (!isNaN(masterUserId)) return this.getUserData(masterUserId);
  }

  async getUsersByMail(mail: string): Promise<UserData[]> {
    return this.userDataRepo.find({
      where: { mail: mail, status: In([UserDataStatus.ACTIVE, UserDataStatus.NA, UserDataStatus.KYC_ONLY]) },
      relations: ['users'],
    });
  }

  async getUserDataByKey(key: string, value: any): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .select('userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `userData.${key}`} = :param`, { param: value })
      .andWhere(`userData.status != :status`, { status: UserDataStatus.MERGED })
      .getOne();
  }

  async createUserData(dto: CreateUserDataDto): Promise<UserData> {
    const userData = this.userDataRepo.create({
      ...dto,
      language: dto.language ?? (await this.languageService.getLanguageBySymbol(Config.defaultLanguage)),
      currency: dto.currency ?? (await this.fiatService.getFiatByName(Config.defaultCurrency)),
    });

    if (dto.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOneBy({ kycFileId: dto.kycFileId });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');
    }

    await this.loadRelationsAndVerify(userData, dto);

    return this.userDataRepo.save(userData);
  }

  async updateUserData(userDataId: number, dto: UpdateUserDataDto): Promise<UserData> {
    let userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: ['users', 'users.wallet'],
    });
    if (!userData) throw new NotFoundException('User data not found');

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

    if (dto.nationality || dto.identDocumentId) {
      const existing = await this.userDataRepo.findOneBy({
        nationality: { id: userData.nationality.id },
        identDocumentId: dto.identDocumentId ?? userData.identDocumentId,
      });
      if (existing) throw new ConflictException('A user with the same nationality and identDocumentId already exists');
    }

    if (dto.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOneBy({ id: Not(userDataId), kycFileId: dto.kycFileId });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');

      await this.userDataRepo.save(Object.assign(userData, { kycFileId: dto.kycFileId }));
    }

    await this.loadRelationsAndVerify(userData, dto);

    const kycChanged = dto.kycLevel && dto.kycLevel !== userData.kycLevel;

    if (dto.bankTransactionVerification === CheckStatus.PASS) {
      // cancel a pending video ident, if ident is completed
      const identCompleted = userData.hasCompletedStep(KycStepName.IDENT);
      const pendingVideo = userData.getPendingStepWith(KycStepName.IDENT, KycStepType.VIDEO);
      if (identCompleted && pendingVideo) userData.cancelStep(pendingVideo);
    }

    // Columns are not updatable
    if (userData.letterSentDate) dto.letterSentDate = userData.letterSentDate;
    if (userData.identificationType) dto.identificationType = userData.identificationType;
    if (userData.verifiedName && dto.verifiedName !== null) dto.verifiedName = userData.verifiedName;

    userData = await this.userDataRepo.save(Object.assign(userData, dto));

    if (kycChanged) await this.kycNotificationService.kycChanged(userData, userData.kycLevel);

    return userData;
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

    return this.userDataRepo.save(Object.assign(user, data));
  }

  async updateTotpSecret(user: UserData, secret: string): Promise<void> {
    await this.userDataRepo.update(user.id, { totpSecret: secret });
  }

  async updateUserName(user: UserData, dto: UserNameDto) {
    await this.userDataRepo.update(user.id, { firstname: dto.firstName, surname: dto.lastName });
  }

  async updateUserSettings(
    user: UserData,
    dto: UpdateUserDto,
    forceUpdate?: boolean,
  ): Promise<{ user: UserData; isKnownUser: boolean }> {
    // check phone & mail if KYC is already started
    if (
      user.kycLevel != KycLevel.LEVEL_0 &&
      (dto.mail === null || dto.mail === '' || dto.phone === null || dto.phone === '')
    )
      throw new BadRequestException('KYC already started, user data deletion not allowed');

    // check language
    if (dto.language) {
      dto.language = await this.languageService.getLanguage(dto.language.id);
      if (!dto.language) throw new BadRequestException('Language not found');
    }

    const mailChanged = dto.mail && dto.mail !== user.mail;

    user = await this.userDataRepo.save(Object.assign(user, dto));

    const isKnownUser = (mailChanged || forceUpdate) && (await this.isKnownKycUser(user));
    return { user, isKnownUser };
  }

  async blockUserData(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.blockUserData());
  }

  async refreshLastNameCheckDate(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.refreshLastCheckedTimestamp());
  }

  async getIdentMethod(userData: UserData): Promise<KycStepType> {
    const defaultIdent = await this.settingService.get('defaultIdentMethod', KycStatus.ONLINE_ID);
    const customIdent = await this.customIdentMethod(userData.id);
    const isVipUser = await this.hasRole(userData.id, UserRole.VIP);

    const ident = isVipUser ? KycStatus.VIDEO_ID : customIdent ?? (defaultIdent as KycStatus);
    return ident === KycStatus.ONLINE_ID ? KycStepType.AUTO : KycStepType.VIDEO;
  }

  private async customIdentMethod(userDataId: number): Promise<KycStatus | undefined> {
    const userWithCustomMethod = await this.userRepo.findOne({
      where: {
        userData: { id: userDataId },
        wallet: { identMethod: Not(IsNull()) },
      },
      relations: { wallet: true },
    });

    return userWithCustomMethod?.wallet.identMethod;
  }

  private async hasRole(userDataId: number, role: UserRole): Promise<boolean> {
    return this.userRepo.exist({ where: { userData: { id: userDataId }, role } });
  }

  private async loadRelationsAndVerify(userData: UserData, dto: UpdateUserDataDto | CreateUserDataDto): Promise<void> {
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

    if (dto.verifiedCountry) {
      userData.verifiedCountry = await this.countryService.getCountry(dto.verifiedCountry.id);
      if (!userData.verifiedCountry) throw new BadRequestException('VerifiedCountry not found');
    }

    if (dto.language) {
      userData.language = await this.languageService.getLanguage(dto.language.id);
      if (!userData.language) throw new BadRequestException('Language not found');
    }

    if (dto.currency) {
      userData.currency = await this.fiatService.getFiat(dto.currency.id);
      if (!userData.currency) throw new BadRequestException('Currency not found');
    }

    if (dto.accountOpener) {
      userData.accountOpener = await this.userDataRepo.findOneBy({ id: dto.accountOpener.id });
      if (!userData.accountOpener) throw new BadRequestException('AccountOpener not found');
    }

    if (dto.verifiedName) {
      const multiAccountIban = await this.multiAccountIbanService.getAllMultiAccountIban();
      if (multiAccountIban.some((m) => dto.verifiedName.includes(m.name)))
        throw new BadRequestException('VerifiedName includes a multiAccountIban');
    }
  }

  async save(userData: UserData): Promise<UserData> {
    return this.userDataRepo.save(userData);
  }

  // --- FEES --- //

  async addFee(userData: UserData, feeId: number): Promise<void> {
    if (userData.individualFeeList?.includes(feeId)) return;

    await this.userDataRepo.update(...userData.addFee(feeId));
  }

  async removeFee(userData: UserData, feeId: number): Promise<void> {
    if (!userData.individualFeeList?.includes(feeId)) throw new BadRequestException('Discount code already removed');

    await this.userDataRepo.update(...userData.removeFee(feeId));
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
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
    if (user.isDfxUser && user.mail) {
      const users = await this.getUsersByMail(user.mail);
      const matchingUser = users.find(
        (u) =>
          u.id !== user.id &&
          u.identDocumentId != null &&
          u.isDfxUser &&
          u.verifiedName &&
          (!user.verifiedName || Util.isSameName(user.verifiedName, u.verifiedName)),
      );
      if (matchingUser) {
        // send a merge request
        await this.mergeService.sendMergeRequest(matchingUser, user);
        return true;
      }
    }

    return false;
  }

  async mergeUserData(masterId: number, slaveId: number, notifyUser = false): Promise<void> {
    if (masterId === slaveId) throw new BadRequestException('Merging with oneself is not possible');

    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({
        where: { id: masterId },
        relations: [
          'users',
          'users.wallet',
          'bankDatas',
          'bankAccounts',
          'accountRelations',
          'relatedAccountRelations',
        ],
      }),
      this.userDataRepo.findOne({
        where: { id: slaveId },
        relations: [
          'users',
          'users.wallet',
          'bankDatas',
          'bankAccounts',
          'accountRelations',
          'relatedAccountRelations',
        ],
      }),
    ]);
    if (!master.isDfxUser) throw new BadRequestException(`Master ${master.id} not allowed to merge. Wrong KYC type`);
    if (slave.amlListAddedDate) throw new BadRequestException('Slave is on AML list');
    if ([master.status, slave.status].includes(UserDataStatus.MERGED))
      throw new BadRequestException('Master or slave is already merged');
    if (slave.verifiedName && !Util.isSameName(master.verifiedName, slave.verifiedName))
      throw new BadRequestException('Verified name mismatch');

    const bankAccountsToReassign = slave.bankAccounts.filter(
      (sba) => !master.bankAccounts.some((mba) => sba.iban === mba.iban),
    );

    const mergedEntitiesString = [
      bankAccountsToReassign.length > 0 && `bank accounts ${bankAccountsToReassign.map((ba) => ba.id)}`,
      slave.bankDatas.length > 0 && `bank datas ${slave.bankDatas.map((b) => b.id)}`,
      slave.users.length > 0 && `users ${slave.users.map((u) => u.id)}`,
      slave.accountRelations.length > 0 && `accountRelations ${slave.accountRelations.map((a) => a.id)}`,
      slave.relatedAccountRelations.length > 0 &&
        `relatedAccountRelations ${slave.relatedAccountRelations.map((a) => a.id)}`,
      slave.individualFees && `individualFees ${slave.individualFees}`,
    ]
      .filter((i) => i)
      .join(' and ');

    const log = `Merging user ${master.id} (master) and ${slave.id} (slave): reassigning ${mergedEntitiesString}`;
    this.logger.info(log);

    await this.updateBankTxTime(slave.id);

    // Notify user about changed mail
    if (notifyUser && slave.mail && master.mail !== slave.mail)
      await this.userDataNotificationService.userDataChangedMailInfo(master, slave);

    // reassign bank accounts, datas, users and userDataRelations
    master.bankAccounts = master.bankAccounts.concat(bankAccountsToReassign);
    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    master.accountRelations = master.accountRelations.concat(slave.accountRelations);
    master.relatedAccountRelations = master.relatedAccountRelations.concat(slave.relatedAccountRelations);
    slave.individualFeeList?.forEach((fee) => !master.individualFeeList?.includes(fee) && master.addFee(fee));

    if (master.status === UserDataStatus.KYC_ONLY) master.status = slave.status;
    master.mail = slave.mail ?? master.mail;

    await this.userDataRepo.save(master);

    // update slave status
    await this.userDataRepo.update(slave.id, {
      status: UserDataStatus.MERGED,
      firstname: `${MergedPrefix}${master.id}`,
    });

    // KYC change Webhook
    await this.kycNotificationService.kycChanged(master);

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

    await this.kycAdminService.createMergeLog(master, log);

    // Notify user about added address
    if (notifyUser) await this.userDataNotificationService.userDataAddedAddressInfo(master, slave);
  }

  private async updateBankTxTime(userDataId: number): Promise<void> {
    const txList = await this.repos.bankTx.find({
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
      await this.repos.bankTx.update(
        txList.map((tx) => tx.id),
        { updated: new Date() },
      );
  }
}
