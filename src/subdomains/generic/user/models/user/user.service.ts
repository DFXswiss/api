import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Util } from 'src/shared/utils/util';
import { UserDetailDto, UserDetails } from './dto/user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { WalletService } from '../wallet/wallet.service';
import { Between, Not } from 'typeorm';
import { AccountType } from '../user-data/account-type.enum';
import { DfiTaxService } from 'src/integration/blockchain/ain/services/dfi-tax.service';
import { Config } from 'src/config/config';
import { ApiKeyDto } from './dto/api-key.dto';
import { KycService } from '../kyc/kyc.service';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CountryService } from 'src/shared/models/country/country.service';
import { VolumeQuery } from './dto/volume-query.dto';
import { KycType, UserData } from '../user-data/user-data.entity';
import { CryptoService } from 'src/integration/blockchain/ain/services/crypto.service';
import { LinkedUserOutDto } from './dto/linked-user.dto';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserDataRepository } from '../user-data/user-data.repository';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
    private readonly walletService: WalletService,
    private readonly dfiTaxService: DfiTaxService,
    private readonly apiKeyService: ApiKeyService,
    private readonly geoLocationService: GeoLocationService,
    private readonly countryService: CountryService,
    private readonly cryptoService: CryptoService,
  ) {}

  async getAllUser(): Promise<User[]> {
    return this.userRepo.find();
  }

  async getUser(userId: number, loadUserData = false): Promise<User> {
    return this.userRepo.findOne(userId, { relations: loadUserData ? ['userData'] : [] });
  }

  async getUserByKey(key: string, value: any): Promise<User> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`user.${key} = :param`, { param: value })
      .getOne();
  }

  async getUserDto(userId: number, detailed = false): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne(userId, { relations: ['userData'] });
    if (!user) throw new NotFoundException('User not found');

    return this.toDto(user, detailed);
  }

  async getAllLinkedUsers(id: number): Promise<LinkedUserOutDto[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('linkedUser.address')
      .leftJoin('user.userData', 'userData')
      .leftJoin('userData.users', 'linkedUser')
      .leftJoin('linkedUser.wallet', 'wallet')
      .where('user.id = :id AND wallet.isKycClient = 0', { id })
      .getRawMany<LinkedUserOutDto>()
      .then((linkedUsers) => {
        return linkedUsers.map((u) => {
          return { ...u, blockchains: this.cryptoService.getBlockchainsBasedOn(u.address) };
        });
      });
  }

  async getRefUser(ref: string): Promise<User> {
    return this.userRepo.findOne({ where: { ref }, relations: ['userData', 'userData.users'] });
  }

  async createUser(dto: CreateUserDto, userIp: string, userOrigin?: string, userData?: UserData): Promise<User> {
    let user = this.userRepo.create(dto);

    user.ip = userIp;
    user.ipCountry = await this.checkIpCountry(userIp);
    user.wallet = await this.walletService.getWalletOrDefault(dto.walletId);
    user.usedRef = await this.checkRef(user, dto.usedRef);
    user.origin = userOrigin;
    user.userData = userData ?? (await this.userDataService.createUserData(user.wallet.customKyc ?? KycType.DFX));
    user = await this.userRepo.save(user);

    const blockchains = this.cryptoService.getBlockchainsBasedOn(user.address);
    if (blockchains.includes(Blockchain.DEFICHAIN)) this.dfiTaxService.activateAddress(user.address);

    return user;
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<{ user: UserDetailDto; isKnownUser: boolean }> {
    let user = await this.userRepo.findOne({ where: { id }, relations: ['userData', 'userData.users'] });
    if (!user) throw new NotFoundException('User not found');

    // update
    user = await this.userRepo.save({ ...user, ...dto });
    const { user: update, isKnownUser } = await this.userDataService.updateUserSettings(user.userData, dto);
    user.userData = update;

    return { user: await this.toDto(user, true), isKnownUser };
  }

  async updateUserInternal(id: number, update: Partial<User>): Promise<User> {
    const user = await this.userRepo.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    if (update.status && update.status == UserStatus.ACTIVE && user.status == UserStatus.NA)
      await this.activateUser(user);
    return this.userRepo.save({ ...user, ...update });
  }

  private async checkIpCountry(userIp: string): Promise<string> {
    // ignore Azure private addresses
    if (userIp?.includes(Config.azureIpSubstring)) {
      return;
    }

    const ipCountry = await this.geoLocationService.getCountry(userIp);

    const country = await this.countryService.getCountryWithSymbol(ipCountry);
    if (!country?.ipEnable && Config.environment !== 'loc')
      throw new ForbiddenException('The country of IP address is not allowed');

    return ipCountry;
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
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
      relations: ['userData'],
      select: ['id', 'userData'],
    });
    await this.userDataService.updateVolumes(userData.id);
  }

  async getUserVolumes(query: VolumeQuery): Promise<{ buy: number; sell: number }> {
    const { buyVolume } = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInEur)', 'buyVolume')
      .leftJoin('user.buys', 'buys')
      .leftJoin('buys.buyCryptos', 'buyCryptos')
      .where('buyCryptos.outputDate BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: AmlCheck.PASS })
      .andWhere('user.id = :userId', { userId: query.userId })
      .getRawOne<{ buyVolume: number }>();

    const { sellVolume } = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyFiats.amountInEur)', 'sellVolume')
      .leftJoin('user.sells', 'sells')
      .leftJoin('sells.buyFiats', 'buyFiats')
      .where('buyFiats.outputDate BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyFiats.amlCheck = :check', { check: AmlCheck.PASS })
      .andWhere('user.id = :userId', { userId: query.userId })
      .getRawOne<{ sellVolume: number }>();

    return { buy: buyVolume ?? 0, sell: sellVolume ?? 0 };
  }

  // --- FEES --- //
  async getUserBuyFee(userId: number, asset: Asset): Promise<{ fee: number }> {
    const { buyFee, userData } = await this.userRepo.findOne({
      select: ['id', 'buyFee', 'userData'],
      where: { id: userId },
      relations: ['userData'],
    });
    const defaultFee =
      userData.accountType === AccountType.PERSONAL
        ? Config.buy.fee.private[asset.feeTier]
        : Config.buy.fee.organization[asset.feeTier];

    return {
      fee: Util.round((buyFee ? Math.min(buyFee, defaultFee) : defaultFee) * 100, Config.defaultPercentageDecimal),
    };
  }

  async getUserSellFee(userId: number, asset: Asset): Promise<{ fee: number }> {
    const { sellFee, userData } = await this.userRepo.findOne({
      select: ['id', 'sellFee', 'userData'],
      where: { id: userId },
      relations: ['userData'],
    });
    const defaultFee =
      userData.accountType === AccountType.PERSONAL
        ? Config.sell.fee.private[asset.feeTier]
        : Config.sell.fee.organization[asset.feeTier];

    return {
      fee: Util.round((sellFee ? Math.min(sellFee, defaultFee) : defaultFee) * 100, Config.defaultPercentageDecimal),
    };
  }

  async getUserCryptoFee(userId: number): Promise<{ fee: number; refBonus: number }> {
    // fee
    const { cryptoFee, usedRef } = await this.userRepo.findOne({
      select: ['id', 'cryptoFee', 'usedRef'],
      where: { id: userId },
    });

    const baseFee = cryptoFee ? Math.min(cryptoFee, Config.crypto.fee) : Config.crypto.fee;

    // ref bonus
    const hasUsedRef = usedRef && usedRef !== '000-000';
    const hasCustomFee = baseFee < Config.crypto.fee;
    const refBonus = hasUsedRef && !hasCustomFee && baseFee >= Config.crypto.refBonus ? Config.crypto.refBonus : 0;

    return {
      fee: Util.round((baseFee - refBonus) * 100, Config.defaultPercentageDecimal),
      refBonus: Util.round(refBonus * 100, Config.defaultPercentageDecimal),
    };
  }

  // --- REF --- //

  async getRefInfo(query: RefInfoQuery): Promise<{ activeUser: number; fiatVolume?: number; cryptoVolume?: number }> {
    // get ref users
    const refUser = await this.userRepo.find({
      select: ['id'],
      where: {
        created: Between(query.from, query.to),
        status: UserStatus.ACTIVE,
        ...(query.refCode ? { usedRef: query.refCode } : {}),
        ...(query.origin ? { origin: query.origin } : {}),
      },
    });

    // get ref volume
    let dbQuery = this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInEur)', 'fiatVolume')
      .leftJoin('user.buys', 'buys')
      .leftJoin('buys.buyCryptos', 'buyCryptos')
      .where('user.created BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: AmlCheck.PASS });

    if (query.refCode) dbQuery = dbQuery.andWhere('user.usedRef = :ref', { ref: query.refCode });
    if (query.origin) dbQuery = dbQuery.andWhere('user.origin = :origin', { origin: query.origin });

    const { fiatVolume } = await dbQuery.getRawOne<{ fiatVolume: number }>();

    dbQuery = this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyCryptos.amountInEur)', 'cryptoVolume')
      .leftJoin('user.cryptoRoutes', 'cryptoRoutes')
      .leftJoin('cryptoRoutes.buyCryptos', 'buyCryptos')
      .where('user.created BETWEEN :from AND :to', { from: query.from, to: query.to })
      .andWhere('buyCryptos.amlCheck = :check', { check: AmlCheck.PASS });

    if (query.refCode) dbQuery = dbQuery.andWhere('user.usedRef = :ref', { ref: query.refCode });
    if (query.origin) dbQuery = dbQuery.andWhere('user.origin = :origin', { origin: query.origin });

    const { cryptoVolume } = await dbQuery.getRawOne<{ cryptoVolume: number }>();

    return { activeUser: refUser.length, fiatVolume: fiatVolume, cryptoVolume: cryptoVolume };
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

  async activateUser(user: User): Promise<void> {
    await this.userRepo.activateUser(user);
    await this.userDataRepo.activateUserData(user.userData);
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
  async createApiKey(userId: number, filter: HistoryFilter): Promise<ApiKeyDto> {
    const user = await this.userRepo.findOne(userId);
    if (!user) throw new BadRequestException('User not found');
    if (user.apiKeyCT) throw new ConflictException('API key already exists');

    user.apiKeyCT = this.apiKeyService.createKey(user.address);
    user.apiFilterCT = this.apiKeyService.getFilterCode(filter);

    await this.userRepo.update(userId, { apiKeyCT: user.apiKeyCT, apiFilterCT: user.apiFilterCT });

    const secret = this.apiKeyService.getSecret(user);

    return { key: user.apiKeyCT, secret: secret };
  }

  async deleteApiKey(userId: number): Promise<void> {
    await this.userRepo.update(userId, { apiKeyCT: null });
  }

  // Only for internal use!
  async checkApiKey(key: string, sign: string, timestamp: string): Promise<User> {
    const user = await this.userRepo.findOne({ apiKeyCT: key });
    if (!user) throw new NotFoundException('API key not found');

    if (!this.apiKeyService.isValidSign(user, sign, timestamp)) throw new ForbiddenException('Invalid API key/sign');

    return user;
  }

  async updateApiFilter(userId: number, filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    if (!user) throw new BadRequestException('User not found');

    user.apiFilterCT = this.apiKeyService.getFilterCode(filter);
    await this.userRepo.update(userId, { apiFilterCT: user.apiFilterCT });

    return this.apiKeyService.getFilterArray(user.apiFilterCT);
  }

  // --- DTO --- //
  private async toDto(user: User, detailed: boolean): Promise<UserDetailDto> {
    return {
      accountType: user.userData?.accountType,
      address: user.address,
      status: user.status,
      mail: user.userData?.mail,
      phone: user.userData?.phone,
      language: user.userData?.language,
      currency: user.userData?.currency,
      kycStatus: user.userData?.kycStatus,
      kycState: user.userData?.kycState,
      kycHash: user.userData?.kycHash,
      tradingLimit: user.userData?.tradingLimit,
      kycDataComplete: this.kycService.isDataComplete(user.userData),
      apiKeyCT: user.apiKeyCT,
      apiFilterCT: this.apiKeyService.getFilterArray(user.apiFilterCT),

      ...(detailed ? await this.getUserDetails(user) : undefined),
      linkedAddresses: detailed ? await this.getAllLinkedUsers(user.id) : undefined,
    };
  }

  private async getUserDetails(user: User): Promise<UserDetails> {
    return {
      ref: user.status === UserStatus.ACTIVE ? user.ref : undefined,
      refFeePercent: user.refFeePercent,
      refVolume: user.refVolume,
      refCredit: user.refCredit,
      paidRefCredit: user.paidRefCredit,
      refCount: await this.userRepo.count({ usedRef: user.ref }),
      refCountActive: await this.userRepo.count({ usedRef: user.ref, status: Not(UserStatus.NA) }),
      bsLink: user.buyVolume + user.sellVolume > Config.bs.volume ? Config.bs.link : undefined,
      buyVolume: { total: user.buyVolume, annual: user.annualBuyVolume },
      sellVolume: { total: user.sellVolume, annual: user.annualSellVolume },
      cryptoVolume: { total: user.cryptoVolume, annual: user.annualCryptoVolume },
      stakingBalance: 0,
    };
  }
}
