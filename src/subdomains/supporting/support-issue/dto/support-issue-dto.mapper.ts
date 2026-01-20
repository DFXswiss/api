import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { WalletDtoMapper } from 'src/subdomains/generic/user/models/wallet/mapper/wallet-dto.mapper';
import { Transaction } from '../../payment/entities/transaction.entity';
import { LimitRequest } from '../entities/limit-request.entity';
import { SupportIssue } from '../entities/support-issue.entity';
import { SupportMessage } from '../entities/support-message.entity';
import {
  SupportIssueDto,
  SupportIssueInternalAccountDataDto,
  SupportIssueInternalDataDto,
  SupportIssueInternalTransactionDataDto,
  SupportIssueLimitRequestDto,
  SupportIssueStateMapper,
  SupportIssueTransactionDto,
  SupportMessageDto,
} from './support-issue.dto';

export class SupportIssueDtoMapper {
  static mapSupportIssue(supportIssue: SupportIssue): SupportIssueDto {
    const dto: SupportIssueDto = {
      uid: supportIssue.uid,
      state: SupportIssueStateMapper[supportIssue.state],
      type: supportIssue.type,
      reason: supportIssue.reason,
      name: supportIssue.name,
      created: supportIssue.created,
      transaction: SupportIssueDtoMapper.mapTransaction(supportIssue.transaction),
      messages: supportIssue.messages?.map(SupportIssueDtoMapper.mapSupportMessage) ?? [],
      limitRequest: SupportIssueDtoMapper.mapLimitRequest(supportIssue.limitRequest),
    };

    return Object.assign(new SupportIssueDto(), dto);
  }

  static mapSupportIssueData(supportIssue: SupportIssue): SupportIssueInternalDataDto {
    const dto: SupportIssueInternalDataDto = {
      id: supportIssue.id,
      created: supportIssue.created,
      uid: supportIssue.uid,
      type: supportIssue.type,
      department: supportIssue.department,
      reason: supportIssue.reason,
      state: supportIssue.state,
      name: supportIssue.name,
      userData: SupportIssueDtoMapper.mapUserData(supportIssue.userData),
      transaction: SupportIssueDtoMapper.mapTransactionData(supportIssue.transaction),
    };

    return Object.assign(new SupportIssueInternalDataDto(), dto);
  }

  static mapSupportMessage(supportMessage: SupportMessage): SupportMessageDto {
    const dto: SupportMessageDto = {
      id: supportMessage.id,
      author: supportMessage.author,
      created: supportMessage.created,
      message: supportMessage.message,
      fileName: supportMessage.fileName,
    };

    return Object.assign(new SupportMessageDto(), dto);
  }

  static mapUserData(userData: UserData): SupportIssueInternalAccountDataDto {
    return {
      id: userData.id,
      status: userData.status,
      verifiedName: userData.verifiedName,
      completeName: userData.completeName,
      accountType: userData.accountType,
      kycLevel: userData.kycLevel,
      depositLimit: userData.depositLimit,
      annualVolume: userData.annualBuyVolume + userData.annualSellVolume + userData.annualCryptoVolume,
      kycHash: userData.kycHash,
      country: userData.country ? CountryDtoMapper.entityToDto(userData.country) : undefined,
    };
  }

  static mapTransactionData(transaction: Transaction): SupportIssueInternalTransactionDataDto {
    if (!transaction?.id) return undefined;

    const wallet = transaction.buyCrypto?.wallet ?? transaction.buyFiat?.wallet;

    return {
      id: transaction.id,
      sourceType: transaction.sourceType,
      type: transaction.type,
      amlCheck: transaction.amlCheck,
      amlReason: transaction.buyCrypto?.amlReason ?? transaction.buyFiat?.amlReason,
      comment: transaction.buyCrypto?.comment ?? transaction.buyFiat?.comment,
      inputAmount: transaction.buyCrypto?.inputAmount ?? transaction.buyFiat?.inputAmount,
      inputAsset: transaction.buyCrypto?.inputAsset ?? transaction.buyFiat?.inputAsset,
      outputAmount: transaction.buyCrypto?.outputAmount ?? transaction.buyFiat?.outputAmount,
      outputAsset: transaction.buyCrypto?.amlReason ?? transaction.buyFiat?.amlReason,
      wallet: wallet ? WalletDtoMapper.mapWalletDto(wallet) : undefined,
      isComplete: transaction.buyCrypto?.isComplete ?? transaction.buyFiat?.isComplete,
    };
  }

  static mapTransaction(transaction: Transaction): SupportIssueTransactionDto {
    if (!transaction?.id) return null;

    return {
      uid: transaction.uid,
      url: transaction.url,
    };
  }

  static mapLimitRequest(limitRequest: LimitRequest): SupportIssueLimitRequestDto {
    if (!limitRequest) return null;

    return {
      id: limitRequest.id,
      limit: limitRequest.limit,
    };
  }
}
