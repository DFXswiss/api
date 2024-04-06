import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { PaymentWebhookData } from '../../user/services/webhook/dto/payment-webhook.dto';
import { WebhookDataMapper } from '../../user/services/webhook/mapper/webhook-data.mapper';
import { ContentType, File, FileType, KycClientDataDto, KycReportDto, KycReportType } from '../dto/kyc-file.dto';
import { DocumentStorageService } from './integration/document-storage.service';

@Injectable()
export class KycClientService {
  constructor(
    private readonly storageService: DocumentStorageService,
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  async getAllKycData(walletId: number): Promise<KycClientDataDto[]> {
    const wallet = await this.walletService.getByIdOrName(walletId, undefined, { users: { userData: true } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet.users.map((b) => this.toKycDataDto(b));
  }

  async getAllPayments(walletId: number, dateFrom: Date, dateTo: Date): Promise<PaymentWebhookData[]> {
    const wallet = await this.walletService.getByIdOrName(walletId, undefined, { users: { userData: true } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return Util.asyncMap(wallet.users, async (user) => {
      return await this.getWebhookData(user.id, dateFrom, dateTo);
    }).then((dto) => dto.flat());
  }

  async getAllUserPayments(
    walletId: number,
    userAddress: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<PaymentWebhookData[]> {
    const wallet = await this.walletService.getByIdOrName(walletId, undefined, { users: { userData: true } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const user = wallet.users.find((u) => u.address === userAddress);
    if (!user) throw new NotFoundException('User not found');

    return this.getWebhookData(user.id, dateFrom, dateTo);
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
  private async getWebhookData(userId: number, dateFrom: Date, dateTo: Date): Promise<PaymentWebhookData[]> {
    const txList = [
      ...(await this.buyCryptoService.getUserTransactions(userId, dateFrom, dateTo)),
      ...(await this.buyFiatService.getUserTransactions(userId, dateFrom, dateTo)),
    ];

    return Util.asyncMap(txList, async (tx) => {
      if (tx instanceof BuyCrypto) {
        return await this.buyCryptoWebhookService
          .extendBuyCrypto(tx)
          .then((bc) =>
            bc.isCryptoCryptoTransaction
              ? WebhookDataMapper.mapCryptoCryptoData(bc)
              : WebhookDataMapper.mapFiatCryptoData(bc),
          );
      } else {
        return await this.buyFiatService.extendBuyFiat(tx).then((bf) => WebhookDataMapper.mapCryptoFiatData(bf));
      }
    });
  }

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
