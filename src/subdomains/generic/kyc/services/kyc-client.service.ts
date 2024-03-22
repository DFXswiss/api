import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { WebhookDataMapper } from '../../user/services/webhook/mapper/webhook-data.mapper';
import { ContentType, File, FileType, KycClientDataDto, KycReportDto, KycReportType } from '../dto/kyc-file.dto';
import { DocumentStorageService } from './integration/document-storage.service';

@Injectable()
export class KycClientService {
  constructor(
    private readonly storageService: DocumentStorageService,
    private readonly userService: UserService,
    private readonly walletService: WalletService,
  ) {}

  async getAllKycData(walletId: number): Promise<KycClientDataDto[]> {
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
  private getFileFor(type: KycReportType, documents: File[]): File | undefined {
    switch (type) {
      case KycReportType.IDENTIFICATION:
        return documents.find((d) => d.type === FileType.IDENTIFICATION && d.contentType === ContentType.PDF);

      default:
        throw new BadRequestException(`Document type ${type} is not supported`);
    }
  }

  private toKycDataDto(user: User): KycClientDataDto {
    return {
      id: user.address,
      ...WebhookDataMapper.mapKycData(user.userData),
    };
  }

  private toKycFileDto(type: KycReportType, { contentType }: File): KycReportDto {
    return { type, contentType };
  }
}
