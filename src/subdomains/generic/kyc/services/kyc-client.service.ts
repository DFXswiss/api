import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { PaymentWebhookData } from '../../user/services/webhook/dto/payment-webhook.dto';
import { WebhookDataMapper } from '../../user/services/webhook/mapper/webhook-data.mapper';
import { FileType, KycClientDataDto, KycFileBlob, KycReportDto, KycReportType } from '../dto/kyc-file.dto';
import { ContentType } from '../enums/content-type.enum';
import { FileCategory } from '../enums/file-category.enum';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class KycClientService {
  constructor(
    private readonly documentService: KycDocumentService,
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyFiatService: BuyFiatService,
    private readonly transactionService: TransactionService,
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
      return this.toPaymentDto(user.id, dateFrom, dateTo);
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

    return this.toPaymentDto(user.id, dateFrom, dateTo);
  }

  async getKycFiles(userAddress: string, walletId: number): Promise<KycReportDto[]> {
    const user = await this.userService.getUserByAddress(userAddress, { userData: true, wallet: true });
    if (!user || user.wallet.id !== walletId) throw new NotFoundException('User not found');

    const allDocuments = await this.documentService.listUserFiles(user.userData.id);

    return Object.values(KycReportType)
      .map((type) => ({ type, info: this.getFileFor(type, allDocuments) }))
      .filter((d) => d.info != null)
      .map(({ type, info }) => this.toKycFileDto(type, info));
  }

  async getKycFile(userAddress: string, walletId: number, type: KycReportType): Promise<any> {
    const user = await this.userService.getUserByAddress(userAddress, { userData: true, wallet: true });
    if (!user || user.wallet.id !== walletId) throw new NotFoundException('User not found');

    const allDocuments = await this.documentService.listUserFiles(user.userData.id);

    const document = this.getFileFor(type, allDocuments);
    if (!document) throw new NotFoundException('File not found');

    return this.documentService
      .downloadFile(FileCategory.USER, user.userData.id, document.type, document.name)
      .then((b) => b.data);
  }

  // --- HELPER METHODS --- //
  private async toPaymentDto(userId: number, dateFrom: Date, dateTo: Date): Promise<PaymentWebhookData[]> {
    const txList = await this.transactionService
      .getTransactionsForUser(userId, dateFrom, dateTo)
      .then((txs) => txs.filter((t) => t.buyCrypto || t.buyFiat).map((t) => t.buyCrypto || t.buyFiat));

    return Util.asyncMap(txList, async (tx) => {
      if (tx instanceof BuyCrypto) {
        return this.buyCryptoWebhookService
          .extendBuyCrypto(tx)
          .then((bc) =>
            bc.isCryptoCryptoTransaction
              ? WebhookDataMapper.mapCryptoCryptoData(bc)
              : WebhookDataMapper.mapFiatCryptoData(bc),
          );
      } else {
        return this.buyFiatService.extendBuyFiat(tx).then((bf) => WebhookDataMapper.mapCryptoFiatData(bf));
      }
    });
  }

  private getFileFor(type: KycReportType, documents: KycFileBlob[]): KycFileBlob | undefined {
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

  private toKycFileDto(type: KycReportType, { contentType }: KycFileBlob): KycReportDto {
    return { type, contentType };
  }
}
