import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Blank,
  BlankType,
  KycCompleted,
  KycInProgress,
  KycStatus,
  KycType,
  UserData,
} from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycDocument } from '../../services/spider/dto/spider.dto';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { UserDataService } from '../user-data/user-data.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { UserDataRepository } from '../user-data/user-data.repository';
import { SpiderSyncService } from 'src/subdomains/generic/user/services/spider/spider-sync.service';
import { KycProcessService } from './kyc-process.service';
import { LinkService } from '../link/link.service';
import { UpdateKycStatusDto } from '../user-data/dto/update-kyc-status.dto';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { WalletRepository } from '../wallet/wallet.repository';
import { HttpService } from 'src/shared/services/http.service';
import { UserRepository } from '../user/user.repository';
import { WalletService } from '../wallet/wallet.service';
import { KycInfo } from './dto/kyc-info.dto';
import { Country } from 'src/shared/models/country/country.entity';

@Injectable()
export class KycService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly walletService: WalletService,
    private readonly spiderService: SpiderService,
    private readonly spiderSyncService: SpiderSyncService,
    private readonly countryService: CountryService,
    private readonly kycProcess: KycProcessService,
    private readonly linkService: LinkService,
    private readonly http: HttpService,
  ) {}

  // --- ADMIN/SUPPORT --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException('User data not found');

    userData.riskState = await this.spiderService.checkCustomer(userData.id);
    if (!userData.riskState) throw new BadRequestException('User is not in Spider');

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  async updateKycStatus(userDataId: number, dto: UpdateKycStatusDto): Promise<void> {
    let userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['users', 'users.wallet'] });
    if (!userData) throw new NotFoundException('User data not found');

    // update status
    if (dto.kycStatus) {
      if (!this.isKycChangeAllowed(userData.kycStatus, dto.kycStatus))
        throw new BadRequestException(`Invalid KYC status change ${userData.kycStatus} -> ${dto.kycStatus}`);

      userData = await this.kycProcess.goToStatus(userData, dto.kycStatus);
    }

    // update state
    if (dto.kycState) userData = this.kycProcess.updateKycState(userData, dto.kycState);

    await this.userDataRepo.save(userData);
  }

  private isKycChangeAllowed(from: KycStatus, to: KycStatus): boolean {
    const allowedChanges = { [KycStatus.ONLINE_ID]: [KycStatus.VIDEO_ID] };
    return allowedChanges[from]?.includes(to);
  }

  // --- KYC DATA --- //
  async resyncKycData(userId: number): Promise<void> {
    await this.spiderSyncService.syncKycUser(userId, true);
  }

  async getKycCountries(code: string, userId?: number): Promise<Country[]> {
    const user = await this.getUser(code, userId);

    return await this.countryService.getCountriesByKycType(user.kycType);
  }

  async updateKycData(code: string, data: KycUserDataDto, userId?: number): Promise<KycInfo> {
    let user = await this.getUser(code, userId);
    if (user.kycStatus !== KycStatus.NA) throw new BadRequestException('KYC already started');

    const isPersonalAccount = (data.accountType ?? user.accountType) === AccountType.PERSONAL;

    // check countries
    const [country, organizationCountry] = await Promise.all([
      this.countryService.getCountry(data.country?.id ?? user.country?.id),
      this.countryService.getCountry(data.organizationCountry?.id ?? user.organizationCountry?.id),
    ]);
    if (!country || (!isPersonalAccount && !organizationCountry)) throw new BadRequestException('Country not found');
    if (!country.isEnabled(user.kycType)) throw new BadRequestException(`Country not allowed for ${user.kycType}`);

    if (isPersonalAccount) {
      data.organizationName = null;
      data.organizationStreet = null;
      data.organizationHouseNumber = null;
      data.organizationLocation = null;
      data.organizationZip = null;
      data.organizationCountry = null;
    }

    user = await this.userDataService.updateSpiderIfNeeded(user, data);

    const updatedUser = await this.userDataRepo.save(Object.assign(user, data));

    return this.createKycInfoBasedOn(updatedUser);
  }

  async transferKycData(userId: number, dto: KycDataTransferDto): Promise<void> {
    let result: { kycId: string };

    const wallet = await this.walletRepo.findOne({ where: { name: dto.walletName } });
    if (!wallet || !wallet.isKycClient || !wallet.apiUrl) throw new NotFoundException('Wallet not found');

    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    if (!user) throw new NotFoundException('DFX user not found');
    if (!KycCompleted(user.userData.kycStatus)) throw new ConflictException('KYC required');

    const apiKey = this.walletService.getApiKeyInternal(wallet.name);
    if (!apiKey) throw new Error(`ApiKey for wallet ${wallet.name} not available`);

    try {
      result = await this.http.get<{ kycId: string }>(`${wallet.apiUrl}/kyc/check`, {
        headers: { 'x-api-key': apiKey },

        params: { address: user.address },
      });
    } catch (error) {
      throw new ServiceUnavailableException(error);
    }

    const slaveUser = await this.userRepo.findOne({ where: { address: result.kycId }, relations: ['userData'] });
    if (!slaveUser) throw new NotFoundException('KYC user not found');
    if (user.userData.id == slaveUser.userData.id) throw new ConflictException('User already merged');

    await this.userDataService.mergeUserData(user.userData.id, slaveUser.userData.id);
  }

  async userDataComplete(userId: number): Promise<boolean> {
    const user = await this.userDataService.getUserDataByUser(userId);
    return this.isDataComplete(user);
  }

  isDataComplete(user: UserData): boolean {
    const requiredFields = [
      'mail',
      'phone',
      'firstname',
      'surname',
      'street',
      'houseNumber',
      'location',
      'zip',
      'country',
    ].concat(
      user?.accountType === AccountType.PERSONAL
        ? []
        : [
            'organizationName',
            'organizationStreet',
            'organizationHouseNumber',
            'organizationLocation',
            'organizationZip',
            'organizationCountry',
          ],
    );
    return requiredFields.filter((f) => !user[f]).length === 0;
  }

  async uploadDocument(
    code: string,
    document: Express.Multer.File,
    kycDocument: KycDocument,
    userId?: number,
  ): Promise<boolean> {
    const userData = await this.getUser(code, userId);

    // create customer, if not existing
    await this.spiderService.createCustomer(userData.id, userData.surname);

    return await this.spiderService.uploadDocument(
      userData.id,
      false,
      kycDocument,
      document.originalname,
      document.mimetype,
      document.buffer,
    );
  }

  // --- KYC PROCESS --- //
  async requestKyc(code: string, userId?: number): Promise<KycInfo> {
    let user = await this.getUser(code, userId);

    // check if KYC already started
    if (user.kycStatus !== KycStatus.NA) {
      throw new BadRequestException('KYC already in progress/completed');
    }

    // check if user data complete
    const dataComplete = this.isDataComplete(user);
    if (!dataComplete) throw new BadRequestException('Ident data incomplete');

    const users = await this.userDataService.getUsersByMail(user.mail);
    const completedUser = users.find((data) => KycCompleted(data.kycStatus));
    if (completedUser && !user.hasExternalUser) {
      await this.linkService.createNewLinkAddress(user, completedUser);
      throw new ConflictException('User already has completed Kyc');
    }

    // update
    user = await this.startKyc(user);
    await this.userDataRepo.save(user);

    return this.createKycInfoBasedOn(user);
  }

  private async startKyc(userData: UserData): Promise<UserData> {
    // update customer
    await this.spiderService.initializeCustomer(userData);

    // do name check
    userData.riskState = await this.spiderService.checkCustomer(userData.id);

    // select KYC type
    const lockUser = userData.users.find((e) => e.wallet.customKyc === KycType.LOCK);
    userData.kycType = lockUser ? KycType.LOCK : KycType.DFX;

    // start KYC
    return await this.kycProcess.startKycProcess(userData);
  }

  async getKycStatus(code: string, userId?: number): Promise<KycInfo> {
    let userData = await this.getUser(code, userId);

    if (KycInProgress(userData.kycStatus)) {
      // update
      userData = await this.kycProcess.checkKycProcess(userData);
      await this.userDataRepo.save(userData);
    }

    return this.createKycInfoBasedOn(userData);
  }

  // --- CREATE KYC INFO --- //

  private createKycInfoBasedOn(userData: UserData): KycInfo {
    const hasSecondUrl = Boolean(userData.spiderData?.secondUrl);
    return {
      kycStatus: userData.kycStatus,
      kycState: userData.kycState,
      kycHash: userData.kycHash,
      kycDataComplete: this.isDataComplete(userData),
      accountType: userData.accountType,
      tradingLimit: userData.tradingLimit,
      blankedPhone: Blank(userData.phone, BlankType.PHONE),
      blankedMail: Blank(userData.mail, BlankType.MAIL),
      sessionUrl: hasSecondUrl ? userData.spiderData?.secondUrl : userData.spiderData?.url,
      setupUrl: hasSecondUrl ? userData.spiderData?.url : undefined,
    };
  }

  // --- GET USER --- //

  private async getUser(code: string, userId?: number): Promise<UserData> {
    return userId ? await this.getUserById(userId) : await this.getUserByKycCode(code);
  }

  private async getUserById(id: number): Promise<UserData> {
    const userData = await this.userDataService.getUserDataByUser(id);
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }

  private async getUserByKycCode(code: string): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({
      where: { kycHash: code },
      relations: ['users', 'users.wallet', 'spiderData'],
    });
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }
}
