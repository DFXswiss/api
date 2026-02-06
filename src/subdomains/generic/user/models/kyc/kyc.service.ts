import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { FileType, KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { Blank, UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { getKycWebhookStatus } from '../../services/webhook/mapper/webhook-data.mapper';
import { BlankType, KycLevel, KycState } from '../user-data/user-data.enum';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import { User } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly countryService: CountryService,
    private readonly http: HttpService,
    private readonly documentService: KycDocumentService,
  ) {}

  // --- KYC DATA --- //

  async getKycCountries(code: string, userDataId?: number): Promise<Country[]> {
    const user = await this.getUser(code, userDataId);

    return this.countryService.getCountriesByKycType(user.kycType);
  }

  async transferKycData(userId: number, dto: KycDataTransferDto): Promise<void> {
    let result: { kycId: string };

    const wallet = await this.walletRepo.findOneBy({ name: dto.walletName });
    if (!wallet || !wallet.isKycClient || !wallet.apiUrl) throw new NotFoundException('Wallet not found');

    const dfxUser = await this.userRepo.findOne({ where: { id: userId }, relations: { userData: true } });
    if (!dfxUser) throw new NotFoundException('DFX user not found');
    if (dfxUser.userData.kycLevel < KycLevel.LEVEL_30) throw new ConflictException('KYC required');
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

    const externalUser = await this.userRepo.findOne({
      where: { address: result.kycId },
      relations: { userData: true },
    });
    if (!externalUser) throw new NotFoundException('KYC user not found');
    if (dfxUser.userData.id == externalUser.userData.id) throw new ConflictException('User already merged');

    await this.userDataService.mergeUserData(dfxUser.userData.id, externalUser.userData.id);
  }

  // --- KYC PROCESS --- //
  async requestKyc(code: string, userDataId?: number): Promise<KycInfo> {
    return this.getKycInfo(code, userDataId);
  }

  async getKycInfo(code: string, userDataId?: number): Promise<KycInfo> {
    const userData = await this.getUser(code, userDataId);

    return this.createKycInfoBasedOn(userData);
  }

  // --- CREATE KYC INFO --- //

  private createKycInfoBasedOn(userData: UserData): KycInfo {
    return {
      kycStatus: userData.kycStatus,
      kycState: KycState.NA,
      kycHash: userData.kycHash,
      kycDataComplete: userData.isDataComplete,
      accountType: userData.accountType,
      tradingLimit: userData.tradingLimit,
      blankedPhone: Blank(userData.phone, BlankType.PHONE),
      blankedMail: Blank(userData.mail, BlankType.MAIL),
      language: LanguageDtoMapper.entityToDto(userData.language),
      sessionUrl: undefined,
      setupUrl: undefined,
    };
  }

  // --- GET USER --- //

  private async getUser(code: string, userDataId?: number): Promise<UserData> {
    return userDataId ? this.getUserById(userDataId) : this.getUserByKycCode(code);
  }

  private async getUserById(id: number): Promise<UserData> {
    const userData = await this.userDataService.getUserData(id, { users: true });
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }

  private async getUserByKycCode(code: string): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({
      where: { kycHash: code },
      relations: { users: { wallet: true } },
    });
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }

  // --- GET COMPANY KYC --- //

  async getAllKycData(walletId: number): Promise<KycDataDto[]> {
    const wallet = await this.walletRepo.findOne({
      where: { id: walletId },
      relations: { users: { userData: true } },
    });

    return wallet.users.map((b) => this.toKycDataDto(b));
  }

  async getKycFiles(userAddress: string, walletId: number): Promise<KycFileDto[]> {
    const user = await this.userRepo.findOne({
      where: { address: userAddress, wallet: { id: walletId } },
      relations: { userData: true, wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const allDocuments = await this.documentService.listUserFiles(user.userData.id);

    return Object.values(KycDocumentType)
      .map((type) => ({ type, info: this.getFileFor(type, allDocuments) }))
      .filter((d) => d.info != null)
      .map(({ type, info }) => this.toKycFileDto(type, info));
  }

  async getKycFile(userAddress: string, walletId: number, type: KycDocumentType): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { address: userAddress, wallet: { id: walletId } },
      relations: { userData: true, wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const allDocuments = await this.documentService.listUserFiles(user.userData.id);
    const document = this.getFileFor(type, allDocuments);
    if (!document) throw new NotFoundException('File not found');

    return this.documentService
      .downloadFile(FileCategory.USER, user.userData.id, document.type, document.name)
      .then((b) => b.data);
  }

  // --- HELPER METHODS --- //
  private toKycDataDto(user: User): KycDataDto {
    return {
      id: user.address,
      kycStatus: getKycWebhookStatus(user.userData.kycStatus, user.userData.kycType),
      kycHash: user.userData.kycHash,
    };
  }

  private toKycFileDto(type: KycDocumentType, { contentType }: KycFileBlob): KycFileDto {
    return { type, contentType };
  }

  private getFileFor(type: KycDocumentType, documents: KycFileBlob[]): KycFileBlob | undefined {
    switch (type) {
      case KycDocumentType.IDENTIFICATION:
        return documents.find((d) => d.type === FileType.IDENTIFICATION && d.contentType === ContentType.PDF);

      case KycDocumentType.CHATBOT:
        // TODO: find PDF result
        return undefined;

      case KycDocumentType.INCORPORATION_CERTIFICATE:
        return documents.find((d) => d.type === FileType.USER_NOTES && d.name.includes('incorporation-certificate'));

      default:
        throw new BadRequestException(`Document type ${type} is not supported`);
    }
  }
}
