import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Active } from 'src/shared/models/active';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { LanguageService } from 'src/shared/models/language/language.service';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { KycInputDataDto } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { InternalFeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { PaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { Between, FindOptionsRelations, Not } from 'typeorm';
import { KycLevel, KycState, KycType, Moderator, UserData, UserDataStatus } from '../user-data/user-data.entity';
import { UserDataRepository } from '../user-data/user-data.repository';
import { WalletService } from '../wallet/wallet.service';
import { LinkedUserOutDto } from './dto/linked-user.dto';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { UpdateUserDto, UpdateUserMailDto } from './dto/update-user.dto';
import { UserDtoMapper } from './dto/user-dto.mapper';
import { UserNameDto } from './dto/user-name.dto';
import { ReferralDto, UserV2Dto } from './dto/user-v2.dto';
import { UserDetailDto, UserDetails } from './dto/user.dto';
import { VolumeQuery } from './dto/volume-query.dto';
import { User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';

@Injectable()
export class UserService {
  private readonly logger = new DfxLogger(UserService);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
    private readonly geoLocationService: GeoLocationService,
    private readonly feeService: FeeService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly siftService: SiftService,
  ) {}

  async getAllUser(): Promise<User[]> {
    return this.userRepo.find();
  }

  async getUser(userId: number, relations: FindOptionsRelations<User> = {}): Promise<User> {
    return this.userRepo.findOne({ where: { id: userId }, relations });
  }

  async getAllUserDataUsers(userDataId: number, relations: FindOptionsRelations<User> = {}): Promise<User[]> {
    return this.userRepo.find({ where: { userData: { id: userDataId } }, relations });
  }

  async getUserByAddress(address: string, relations: FindOptionsRelations<User> = {}): Promise<User> {
    return this.userRepo.findOne({ where: { address }, relations });
  }

  async getUserByKey(key: string, value: any): Promise<User> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `user.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getUserDto(userId: number, detailed = false): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: { userData: true, wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.toDto(user, detailed);
  }

  async getAllLinkedUsers(id: number): Promise<LinkedUserOutDto[]> {
    const linkedUsers = await this.userRepo
      .createQueryBuilder('user')
      .select('linkedUser.address', 'address')
      .leftJoin('user.userData', 'userData')
      .leftJoin('userData.users', 'linkedUser')
      .leftJoin('linkedUser.wallet', 'wallet')
      .where('user.id = :id', { id })
      .andWhere('wallet.isKycClient = 0')
      .andWhere('linkedUser.status NOT IN (:...userStatus)', {
        userStatus: [UserStatus.BLOCKED, UserStatus.DELETED],
      })
      .andWhere('user.role != :role', { role: UserRole.CUSTODY })
      .getRawMany<{ address: string }>();

    return linkedUsers.map((u) => ({
      address: u.address,
      blockchains: CryptoService.getBlockchainsBasedOn(u.address),
    }));
  }

  async getOpenRefCreditUser(): Promise<User[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.userData', 'userData')
      .where('user.refCredit - user.paidRefCredit > 0')
      .andWhere('user.status NOT IN (:...userStatus)', { userStatus: [UserStatus.BLOCKED, UserStatus.DELETED] })
      .andWhere('userData.status NOT IN (:...userDataStatus)', {
        userDataStatus: [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED],
      })
      .andWhere('userData.kycLevel != :kycLevel', { kycLevel: KycLevel.REJECTED })
      .getMany();
  }

  async getRefUser(ref: string): Promise<User> {
    return this.userRepo.findOne({ where: { ref }, relations: { userData: true } });
  }

  async getNexCustodyIndex(): Promise<number> {
    const currentIndex = await this.userRepo.maximum('custodyAddressIndex');
    return (currentIndex ?? -1) + 1;
  }

  async getUserDtoV2(userDataId: number, userId?: number): Promise<UserV2Dto> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true } },
    });
    if (!userData) throw new NotFoundException('User not found');
    if (userData.status === UserDataStatus.MERGED) throw new UnauthorizedException('User is merged');

    return UserDtoMapper.mapUser(userData, userId);
  }

  async getRefDtoV2(userId: number): Promise<ReferralDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
    });

    const { refCount, refCountActive } = await this.getRefUserCounts(user);

    return UserDtoMapper.mapRef(user, refCount, refCountActive);
  }

  async createUser(data: Partial<User>, specialCode: string, moderator?: Moderator): Promise<User> {
    let user = this.userRepo.create({
      address: data.address,
      signature: data.signature,
      addressType: CryptoService.getAddressType(data.address),
    });
    const userIsActive = data.userData?.status === UserDataStatus.ACTIVE;

    user.ip = data.ip;
    user.ipCountry = this.geoLocationService.getCountry(data.ip);
    user.wallet = data.wallet ?? (await this.walletService.getDefault());
    user.usedRef = await this.checkRef(user, data.usedRef);
    user.origin = data.origin;
    user.custodyProvider = data.custodyProvider;
    userIsActive && (user.status = UserStatus.ACTIVE);
    user.custodyAddressType = data.custodyAddressType;
    user.custodyAddressIndex = data.custodyAddressIndex;
    user.role = data.role;

    const language = await this.languageService.getLanguageByCountry(user.ipCountry);
    const currency = await this.fiatService.getFiatByCountry(user.ipCountry);

    user.userData =
      data.userData ??
      (await this.userDataService.createUserData({
        kycType: user.wallet.customKyc ?? KycType.DFX,
        language,
        currency,
        wallet: user.wallet,
      }));

    if (user.userData.status === UserDataStatus.KYC_ONLY)
      await this.userDataService.updateUserDataInternal(user.userData, { status: UserDataStatus.NA });

    if (moderator) await this.setModerator(user, moderator);

    user = await this.userRepo.save(user);
    userIsActive && (await this.userRepo.setUserRef(user, data.userData?.kycLevel));

    await this.siftService.createAccount(user);

    try {
      if (specialCode) await this.feeService.addSpecialCodeUser(user, specialCode);
      if (data.usedRef || data.wallet) await this.feeService.addCustomSignUpFees(user, user.usedRef);
    } catch (e) {
      this.logger.warn(`Error while adding specialCode to new user ${user.id}:`, e);
    }

    return user;
  }

  async setModerator(user: User, moderator: Moderator): Promise<void> {
    if (!user.usedRef) await this.userRepo.update(user.id, { usedRef: Config.moderators[moderator] });
    await this.userDataService.updateUserDataInternal(user.userData, { moderator });
  }

  async updateUserV1(id: number, dto: UpdateUserDto): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { userData: { users: true }, wallet: true } });
    if (!user) throw new NotFoundException('User not found');

    // update
    user.userData = await this.userDataService.updateUserSettings(user.userData, dto);

    return this.toDto(user, true);
  }

  async updateUser(userDataId: number, dto: UpdateUserDto, userId?: number): Promise<UserV2Dto> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true } },
    });
    if (!userData) throw new NotFoundException('User not found');

    const update = await this.userDataService.updateUserSettings(userData, dto);

    return UserDtoMapper.mapUser(update, userId);
  }

  async updateUserMail(userDataId: number, dto: UpdateUserMailDto, ip: string): Promise<void> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true } },
    });
    if (!userData) throw new NotFoundException('User not found');

    await this.userDataService.updateUserMail(userData, dto, ip);
  }

  async verifyMail(userDataId: number, token: string, userId: number): Promise<UserV2Dto> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true } },
    });

    const user = await this.userDataService.verifyUserMail(userData, token);

    return UserDtoMapper.mapUser(user, userId);
  }

  async updateUserName(id: number, dto: UserNameDto): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { userData: { users: true } } });
    if (user.userData.kycLevel >= KycLevel.LEVEL_20) throw new BadRequestException('KYC already started');
    if (user.userData.completeName) throw new BadRequestException('Name is already set');

    await this.userDataService.updateUserName(user.userData, dto);
  }

  async updateUserData(id: number, dto: KycInputDataDto): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { userData: { users: true }, wallet: true },
    });
    if (user.userData.kycLevel !== KycLevel.LEVEL_0 || (user.userData.mail && user.userData.mail !== dto.mail))
      throw new BadRequestException('KYC already started, mail already set');

    user.userData = await this.userDataService.trySetUserMail(user.userData, dto.mail);
    user.userData = await this.userDataService.updatePersonalData(user.userData, dto);

    return this.toDto(user, true);
  }

  async updateUserInternal(id: number, update: UpdateUserAdminDto): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { userData: true } });
    if (!user) throw new NotFoundException('User not found');

    if (update.status && update.status === UserStatus.ACTIVE && user.status === UserStatus.NA)
      await this.activateUser(user, user.userData);

    if (update.status && update.status === UserStatus.BLOCKED)
      await this.siftService.sendUserBlocked(user, update.comment);

    if (update.setRef) await this.userRepo.setUserRef(user, KycLevel.LEVEL_50);

    return this.userRepo.save({ ...user, ...update });
  }

  async updateAddress(userDataId: number, address: string, dto: UpdateAddressDto): Promise<UserV2Dto> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true } },
    });
    if (!userData) throw new NotFoundException('User not found');

    const userToUpdate = userData.users.find((u) => u.address === address);
    if (!userToUpdate) throw new NotFoundException('Address not found');

    await this.userRepo.update(...userToUpdate.setLabel(dto.label));

    return UserDtoMapper.mapUser(userData);
  }

  async deactivateUser(userDataId: number, address?: string): Promise<void> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: true, kycSteps: true },
    });
    if (!userData) throw new NotFoundException('User account not found');
    if (userData.isBlockedOrDeactivated) throw new BadRequestException('User account already deactivated');

    if (address) {
      const user = userData.users.find((u) => u.address === address);
      if (!user) throw new NotFoundException('Address not found');
      if (user.isBlockedOrDeleted) throw new BadRequestException('Address already deleted or blocked');

      await this.userRepo.update(...user.deleteUser('Manual user deletion'));
      return;
    }

    await this.userDataService.deactivateUserData(userData);
  }

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.userRepo.update({ annualBuyVolume: Not(0) }, { annualBuyVolume: 0 });
    await this.userRepo.update({ annualSellVolume: Not(0) }, { annualSellVolume: 0 });
  }

  async updateBuyVolume(userId: number, volume: number, annualVolume: number): Promise<void> {
    await this.userRepo.update(userId, {
      buyVolume: Util.round(volume, Config.defaultVolumeDecimal),
      annualBuyVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    await this.updateUserDataVolume(userId);
  }

  async updateCryptoVolume(userId: number, volume: number, annualVolume: number): Promise<void> {
    await this.userRepo.update(userId, {
      cryptoVolume: Util.round(volume, Config.defaultVolumeDecimal),
      annualCryptoVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    await this.updateUserDataVolume(userId);
  }

  async updateSellVolume(userId: number, volume: number, annualVolume: number): Promise<void> {
    await this.userRepo.update(userId, {
      sellVolume: Util.round(volume, Config.defaultVolumeDecimal),
      annualSellVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    await this.updateUserDataVolume(userId);
  }

  private async updateUserDataVolume(userId: number): Promise<void> {
    const { userData } = await this.userRepo.findOne({
      where: { id: userId },
      relations: { userData: true },
      select: ['id', 'userData'],
    });
    await this.userDataService.updateVolumes(userData.id);
  }

  async getUserVolumes(query: VolumeQuery): Promise<{ buy: number; sell: number }> {
    const { buyVolume } = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInChf)', 'buyVolume')
      .leftJoin('user.buys', 'buys')
      .leftJoin('buys.buyCryptos', 'buyCryptos')
      .where('buyCryptos.outputDate BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: CheckStatus.PASS })
      .andWhere('user.id = :userId', { userId: query.userId })
      .getRawOne<{ buyVolume: number }>();

    const { sellVolume } = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyFiats.amountInChf)', 'sellVolume')
      .leftJoin('user.sells', 'sells')
      .leftJoin('sells.buyFiats', 'buyFiats')
      .where('buyFiats.outputDate BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyFiats.amlCheck = :check', { check: CheckStatus.PASS })
      .andWhere('user.id = :userId', { userId: query.userId })
      .getRawOne<{ sellVolume: number }>();

    return { buy: buyVolume ?? 0, sell: sellVolume ?? 0 };
  }

  // --- FEES --- //
  async getUserFee(
    userId: number,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    bankIn: CardBankName | IbanBankName,
    bankOut: CardBankName | IbanBankName,
    from: Active,
    to: Active,
  ): Promise<InternalFeeDto> {
    const user = await this.getUser(userId, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    return this.feeService.getUserFee({
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      txVolume: undefined,
      specialCodes: [],
      allowCachedBlockchainFee: true,
      bankIn,
      bankOut,
    });
  }

  // --- REF --- //

  async getRefInfo(
    query: RefInfoQuery,
  ): Promise<{ activeUser: number; passiveUser: number; fiatVolume?: number; cryptoVolume?: number }> {
    // get ref users
    const refUserCount = await this.userRepo.countBy({
      created: Between(query.from, query.to),
      status: UserStatus.ACTIVE,
      ...(query.refCode ? { usedRef: query.refCode } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
    });

    // get passive ref users
    const passiveRefUserCount = await this.userRepo.countBy({
      created: Between(query.from, query.to),
      status: UserStatus.NA,
      ...(query.refCode ? { usedRef: query.refCode } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
    });

    // get ref volume
    let dbQuery = this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInEur)', 'fiatVolume')
      .leftJoin('user.buys', 'buys')
      .leftJoin('buys.buyCryptos', 'buyCryptos')
      .where('user.created BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: CheckStatus.PASS });

    if (query.refCode) dbQuery = dbQuery.andWhere('user.usedRef = :ref', { ref: query.refCode });
    if (query.origin) dbQuery = dbQuery.andWhere('user.origin = :origin', { origin: query.origin });

    const { fiatVolume } = await dbQuery.getRawOne<{ fiatVolume: number }>();

    dbQuery = this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInEur)', 'cryptoVolume')
      .leftJoin('user.cryptoRoutes', 'cryptoRoutes')
      .leftJoin('cryptoRoutes.buyCryptos', 'buyCryptos')
      .where('user.created BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: CheckStatus.PASS });

    if (query.refCode) dbQuery = dbQuery.andWhere('user.usedRef = :ref', { ref: query.refCode });
    if (query.origin) dbQuery = dbQuery.andWhere('user.origin = :origin', { origin: query.origin });

    const { cryptoVolume } = await dbQuery.getRawOne<{ cryptoVolume: number }>();

    return {
      activeUser: refUserCount,
      passiveUser: passiveRefUserCount,
      fiatVolume: fiatVolume,
      cryptoVolume: cryptoVolume,
    };
  }

  async updateRefVolume(ref: string, volume: number, credit: number): Promise<void> {
    await this.userRepo.update(
      { ref },
      {
        refVolume: Util.round(volume, Config.defaultVolumeDecimal),
        refCredit: Util.round(credit, Config.defaultVolumeDecimal),
      },
    );
  }

  async updatePaidRefCredit(id: number, volume: number): Promise<void> {
    await this.userRepo.update(id, { paidRefCredit: Util.round(volume, Config.defaultVolumeDecimal) });
  }

  async activateUser(user: User, userData: UserData): Promise<void> {
    await this.userRepo.update(...user.activateUser());
    await this.userDataRepo.activateUserData(userData);
  }

  private async checkRef(user: User, usedRef: string): Promise<string> {
    const refUser = await this.getRefUser(usedRef);
    return usedRef === null ||
      usedRef === user.ref ||
      (usedRef && !refUser) ||
      user?.userData?.id === refUser?.userData?.id
      ? '000-000'
      : usedRef;
  }

  public async getTotalRefRewards(): Promise<number> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('SUM(paidRefCredit)', 'paidRefCredit')
      .getRawOne<{ paidRefCredit: number }>()
      .then((r) => r.paidRefCredit);
  }

  // --- API KEY --- //
  async deleteApiKey(userId: number): Promise<void> {
    await this.userRepo.update(userId, { apiKeyCT: null });
  }

  // Only for internal use!
  async checkApiKey(key: string, sign: string, timestamp: string): Promise<User> {
    const user = await this.userRepo.findOneBy({ apiKeyCT: key });
    if (!user) throw new NotFoundException('API key not found');

    if (!ApiKeyService.isValidSign(user, sign, timestamp)) throw new ForbiddenException('Invalid API key/sign');

    return user;
  }

  async updateApiFilter(userId: number, filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: { userData: true } });
    if (!user) throw new BadRequestException('User not found');

    user.apiFilterCT = ApiKeyService.getFilterCode(filter);
    await this.userRepo.update(userId, { apiFilterCT: user.apiFilterCT });

    return ApiKeyService.getFilterArray(user.apiFilterCT);
  }

  // --- DTO --- //
  private async toDto(user: User, detailed: boolean): Promise<UserDetailDto> {
    return {
      accountType: user.userData?.accountType,
      wallet: user.wallet.name,
      address: user.address,
      status: user.status,
      mail: user.userData?.mail,
      phone: user.userData?.phone,
      language: LanguageDtoMapper.entityToDto(user.userData?.language),
      currency: user.userData?.currency,
      kycStatus: user.userData?.kycStatus,
      kycState: KycState.NA,
      kycLevel: user.userData?.kycLevelDisplay,
      kycHash: user.userData?.kycHash,
      tradingLimit: user.userData?.tradingLimit,
      kycDataComplete: user.userData?.isDataComplete,
      apiKeyCT: user.userData?.apiKeyCT ?? user.apiKeyCT,
      apiFilterCT: ApiKeyService.getFilterArray(user.userData?.apiFilterCT ?? user.apiFilterCT),
      ...(detailed ? await this.getUserDetails(user) : undefined),
      linkedAddresses: detailed ? await this.getAllLinkedUsers(user.id) : undefined,
    };
  }

  private async getUserDetails(user: User): Promise<UserDetails> {
    return {
      ...(user.ref ? await this.getUserRef(user) : undefined),
      bsLink:
        user.buyVolume + user.sellVolume + user.cryptoVolume >= Config.support.blackSquad.limit
          ? Config.support.blackSquad.link
          : undefined,
      buyVolume: { total: user.buyVolume, annual: user.annualBuyVolume },
      sellVolume: { total: user.sellVolume, annual: user.annualSellVolume },
      cryptoVolume: { total: user.cryptoVolume, annual: user.annualCryptoVolume },
      stakingBalance: 0,
    };
  }

  private async getUserRef(user: User): Promise<Partial<UserDetails>> {
    return {
      ref: user.ref,
      refFeePercent: user.refFeePercent,
      refVolume: user.refVolume,
      refCredit: user.refCredit,
      paidRefCredit: user.paidRefCredit,
      ...(await this.getRefUserCounts(user)),
    };
  }

  private async getRefUserCounts(user: User): Promise<{ refCount: number; refCountActive: number }> {
    return user.ref
      ? {
          refCount: await this.userRepo.countBy({ usedRef: user.ref }),
          refCountActive: await this.userRepo.countBy({ usedRef: user.ref, status: UserStatus.ACTIVE }),
        }
      : { refCount: 0, refCountActive: 0 };
  }
}
