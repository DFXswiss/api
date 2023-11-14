import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import {
  Blank,
  BlankType,
  KycCompleted,
  KycInProgress,
  KycState,
  KycStatus,
  UserData,
} from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SpiderSyncService } from 'src/subdomains/generic/user/services/spider/spider-sync.service';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { DocumentInfo, KycDocument } from '../../services/spider/dto/spider.dto';
import { SpiderApiService } from '../../services/spider/spider-api.service';
import { WebhookService } from '../../services/webhook/webhook.service';
import { UpdateKycStatusDto } from '../user-data/dto/update-kyc-status.dto';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import { User } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { WalletService } from '../wallet/wallet.service';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycProcessService } from './kyc-process.service';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly walletService: WalletService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
    private readonly spiderSyncService: SpiderSyncService,
    private readonly countryService: CountryService,
    private readonly kycProcess: KycProcessService,
    private readonly http: HttpService,
    private readonly webhookService: WebhookService,
  ) {}

  // --- ADMIN/SUPPORT --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOneBy({ id: userDataId });
    if (!userData) throw new NotFoundException('User data not found');

    userData.riskResult = await this.spiderService.checkCustomer(userData.id);
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

  async syncKycFiles(userDataId: number, ignoreNameChecks: boolean): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId);
    await this.spiderSyncService.syncKycFiles(userData, ignoreNameChecks);
  }

  async getKycCountries(code: string, userId?: number): Promise<Country[]> {
    const user = await this.getUser(code, userId);

    return this.countryService.getCountriesByKycType(user.kycType);
  }

  async updateKycData(code: string, data: KycUserDataDto, userId?: number): Promise<KycInfo> {
    const user = await this.getUser(code, userId);
    if (user.kycStatus !== KycStatus.NA) throw new BadRequestException('KYC already started');

    const updatedUser = await this.userDataService.updateKycData(user, data);
    return this.createKycInfoBasedOn(updatedUser);
  }

  async transferKycData(userId: number, dto: KycDataTransferDto): Promise<void> {
    let result: { kycId: string };

    const wallet = await this.walletRepo.findOneBy({ name: dto.walletName });
    if (!wallet || !wallet.isKycClient || !wallet.apiUrl) throw new NotFoundException('Wallet not found');

    const dfxUser = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    if (!dfxUser) throw new NotFoundException('DFX user not found');
    if (!KycCompleted(dfxUser.userData.kycStatus)) throw new ConflictException('KYC required');

    const apiKey = this.walletService.getApiKeyInternal(wallet.name);
    if (!apiKey) throw new Error(`ApiKey for wallet ${wallet.name} not available`);

    try {
      result = await this.http.get<{ kycId: string }>(`${wallet.apiUrl}/check`, {
        headers: { 'x-api-key': apiKey },

        params: { address: dfxUser.address },
      });
    } catch (e) {
      this.logger.error('Failed to transfer KYC data:', e);
      throw new ServiceUnavailableException(`Failed to transfer KYC data: ${e.message}`);
    }

    const externalUser = await this.userRepo.findOne({ where: { address: result.kycId }, relations: ['userData'] });
    if (!externalUser) throw new NotFoundException('KYC user not found');
    if (dfxUser.userData.id == externalUser.userData.id) throw new ConflictException('User already merged');

    await this.userDataService.mergeUserData(dfxUser.userData.id, externalUser.userData.id);
  }

  async triggerWebhook(userDataId: number, reason?: string): Promise<void> {
    const user = await this.userDataService.getUserData(userDataId);
    if (!user) throw new NotFoundException('User not found');

    if (user.kycState === KycState.FAILED) {
      await this.webhookService.kycFailed(user, reason ?? 'KYC failed');
    } else {
      await this.webhookService.kycChanged(user);
    }
  }

  async userDataComplete(userId: number): Promise<boolean> {
    const user = await this.userDataService.getUserDataByUser(userId);
    return this.isDataComplete(user);
  }

  isDataComplete(user: UserData): boolean {
    const requiredFields = ['mail', 'phone', 'firstname', 'surname', 'street', 'location', 'zip', 'country'].concat(
      user?.accountType === AccountType.PERSONAL
        ? []
        : ['organizationName', 'organizationStreet', 'organizationLocation', 'organizationZip', 'organizationCountry'],
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

    return this.spiderService.uploadDocument(
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

    // check if user already has KYC
    const hasKyc = await this.userDataService.isKnownKycUser(user);
    if (hasKyc) throw new ConflictException('User already has completed KYC');

    // update
    user = await this.startKyc(user);
    await this.userDataRepo.save(user);

    return this.createKycInfoBasedOn(user);
  }

  private async startKyc(userData: UserData): Promise<UserData> {
    // update customer
    await this.spiderService.initializeCustomer(userData);

    // do name check
    userData.riskResult = await this.spiderService.checkCustomer(userData.id);

    // start KYC
    return this.kycProcess.startKycProcess(userData);
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
      language: LanguageDtoMapper.entityToDto(userData.language),
      sessionUrl: hasSecondUrl ? userData.spiderData?.secondUrl : userData.spiderData?.url,
      setupUrl: hasSecondUrl ? userData.spiderData?.url : undefined,
    };
  }

  // --- GET USER --- //

  private async getUser(code: string, userId?: number): Promise<UserData> {
    return userId ? this.getUserById(userId) : this.getUserByKycCode(code);
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

  // --- GET COMPANY KYC --- //

  async getAllKycData(walletId: number): Promise<KycDataDto[]> {
    const wallet = await this.walletRepo.findOne({
      where: { id: walletId },
      relations: ['users', 'users.userData'],
    });

    return wallet.users.map((b) => this.toKycDataDto(b));
  }

  async getKycFiles(userAddress: string, walletId: number): Promise<KycFileDto[]> {
    const user = await this.userRepo.findOne({
      where: { address: userAddress, wallet: { id: walletId } },
      relations: ['userData', 'wallet'],
    });
    if (!user) throw new NotFoundException('User not found');

    const allDocuments = await this.spiderApiService.getDocumentInfos(user.userData.id, false);

    return Object.values(KycDocumentType)
      .map((type) => ({ type, info: this.getDocumentInfoFor(type, allDocuments) }))
      .filter((d) => d.info != null)
      .map(({ type, info }) => this.toKycFileDto(type, info));
  }

  async getKycFile(userAddress: string, walletId: number, kycDocumentType: KycDocumentType): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { address: userAddress, wallet: { id: walletId } },
      relations: ['userData', 'wallet'],
    });
    if (!user) throw new NotFoundException('User not found');

    const allDocuments = await this.spiderApiService.getDocumentInfos(user.userData.id, false);
    const document = this.getDocumentInfoFor(kycDocumentType, allDocuments);

    return this.spiderApiService.getBinaryDocument(
      user.userData.id,
      false,
      document.document,
      document.version,
      document.part,
    );
  }

  // --- HELPER METHODS --- //
  private toKycDataDto(user: User): KycDataDto {
    return {
      id: user.address,
      kycStatus: this.webhookService.getKycWebhookStatus(user.userData.kycStatus, user.userData.kycType),
      kycHash: user.userData.kycHash,
    };
  }

  private toKycFileDto(type: KycDocumentType, { contentType }: DocumentInfo): KycFileDto {
    return { type, contentType };
  }

  private getDocumentInfoFor(type: KycDocumentType, documents: DocumentInfo[]): DocumentInfo | undefined {
    switch (type) {
      case KycDocumentType.IDENTIFICATION:
        return (
          this.getReportDocumentInfo(KycDocument.ONLINE_IDENTIFICATION, documents) ??
          this.getReportDocumentInfo(KycDocument.VIDEO_IDENTIFICATION, documents)
        );

      case KycDocumentType.CHATBOT:
        return this.getReportDocumentInfo(KycDocument.CHATBOT_ONBOARDING, documents);

      case KycDocumentType.INCORPORATION_CERTIFICATE:
        return documents.find((d) => d.document === KycDocument.INCORPORATION_CERTIFICATE);

      default:
        throw new BadRequestException(`Document type ${type} is not supported`);
    }
  }

  private getReportDocumentInfo(type: KycDocument, documents: DocumentInfo[]): DocumentInfo | undefined {
    return documents.find((d) => d.document === type && d.label === 'Report');
  }
}
