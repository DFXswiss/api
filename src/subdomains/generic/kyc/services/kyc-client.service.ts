import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { KycContentType, KycDataDto, KycFile, KycFileType, KycReportDto, KycReportType } from '../dto/kyc-file.dto';
import { DocumentStorageService } from './integration/document-storage.service';

@Injectable()
export class KycClientService {
  constructor(
    private readonly storageService: DocumentStorageService,
    private readonly userService: UserService,
    private readonly walletService: WalletService,
  ) {}

  async getAllKycData(walletId: number): Promise<KycDataDto[]> {
    const wallet = await this.walletService.getByIdOrName(walletId, undefined, { users: { userData: true } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet.users.map((b) => this.toKycDataDto(b));
  }

  async getKycFiles(userAddress: string, walletId: number): Promise<KycReportDto[]> {
    const user = await this.userService.getUserByAddress(userAddress, { userData: true, wallet: true });
    if (!user || user.wallet.id !== walletId) throw new NotFoundException('User not found');

    const allDocuments = await this.storageService.listUserFiles(user.userData.id);

    return Object.values(KycReportType)
      .map((type) => ({ type, info: this.getFileFor(type, allDocuments) }))
      .filter((d) => d.info != null)
      .map(({ type, info }) => this.toKycFileDto(type, info));
  }

  async getKycFile(userAddress: string, walletId: number, type: KycReportType): Promise<any> {
    const user = await this.userService.getUserByAddress(userAddress, { userData: true, wallet: true });
    if (!user || user.wallet.id !== walletId) throw new NotFoundException('User not found');

    const allDocuments = await this.storageService.listUserFiles(user.userData.id);

    const document = this.getFileFor(type, allDocuments);
    if (!document) throw new NotFoundException('File not found');

    return this.storageService.downloadFile(user.userData.id, document.type, document.name).then((b) => b.data);
  }

  // --- HELPER METHODS --- //
  private getFileFor(type: KycReportType, documents: KycFile[]): KycFile | undefined {
    switch (type) {
      case KycReportType.IDENTIFICATION:
        return documents.find((d) => d.type === KycFileType.IDENTIFICATION && d.contentType === KycContentType.PDF);

      default:
        throw new BadRequestException(`Document type ${type} is not supported`);
    }
  }

  private toKycDataDto(user: User): KycDataDto {
    return {
      id: user.address,
      kycLevel: user.userData.kycLevel,
      kycHash: user.userData.kycHash,
    };
  }

  private toKycFileDto(type: KycReportType, { contentType }: KycFile): KycReportDto {
    return { type, contentType };
  }
}
