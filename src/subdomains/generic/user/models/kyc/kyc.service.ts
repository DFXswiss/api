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
import { Util } from 'src/shared/utils/util';
import { KycContentType, KycFile, KycFileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import {
  Blank,
  BlankType,
  KycCompleted,
  KycState,
  KycStatus,
  UserData,
} from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { WebhookService } from '../../services/webhook/webhook.service';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import { User } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly countryService: CountryService,
    private readonly http: HttpService,
    private readonly webhookService: WebhookService,
    private readonly storageService: DocumentStorageService,
  ) {}

  // --- ADMIN/SUPPORT --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOneBy({ id: userDataId });
    if (!userData) throw new NotFoundException('User data not found');

    //if (!userData.riskState) throw new BadRequestException('User is not in Spider');

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  // --- KYC DATA --- //

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
    if (!wallet.apiKey) throw new Error(`ApiKey for wallet ${wallet.name} not available`);

    try {
      result = await this.http.get<{ kycId: string }>(`${wallet.apiUrl}/check`, {
        headers: { 'x-api-key': wallet.apiKey },

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
    const user = await this.userDataService.getUserData(userDataId, { users: true });
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
    kycDocument: KycFileType,
    userId?: number,
  ): Promise<boolean> {
    const userData = await this.getUser(code, userId);

    const upload = await this.storageService.uploadFile(
      userData.id,
      kycDocument,
      `${Util.isoDate(new Date()).split('-').join('')}-incorporation-certificate-${document.filename}`,
      document.buffer,
      document.mimetype as KycContentType,
    );
    return upload != '';
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
    // TODO
    return userData;
  }

  async getKycStatus(code: string, userId?: number): Promise<KycInfo> {
    const userData = await this.getUser(code, userId);

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

    const allDocuments = await this.storageService.listUserFiles(user.userData.id);
    return allDocuments.map((d) => this.toKycFileDto(d));
  }

  async getKycFile(userAddress: string, walletId: number, kycDocumentType: KycDocumentType): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { address: userAddress, wallet: { id: walletId } },
      relations: ['userData', 'wallet'],
    });
    if (!user) throw new NotFoundException('User not found');

    //TODO kycDocumentType mapping?

    return;
  }

  // --- HELPER METHODS --- //
  private toKycDataDto(user: User): KycDataDto {
    return {
      id: user.address,
      kycStatus: this.webhookService.getKycWebhookStatus(user.userData.kycStatus, user.userData.kycType),
      kycHash: user.userData.kycHash,
    };
  }

  private toKycFileDto({ type, contentType }: KycFile): KycFileDto {
    return {
      type: type == KycFileType.IDENTIFICATION ? KycDocumentType.IDENTIFICATION : KycDocumentType.CHATBOT,
      contentType,
    };
  }
}
