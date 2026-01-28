import { Asset } from 'src/shared/models/asset/asset.entity';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
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

  static mapSupportIssueData(supportIssue: SupportIssue, transactionInput?: Asset): SupportIssueInternalDataDto {
    const dto: SupportIssueInternalDataDto = {
      id: supportIssue.id,
      created: supportIssue.created,
      uid: supportIssue.uid,
      type: supportIssue.type,
      department: supportIssue.department,
      reason: supportIssue.reason,
      state: supportIssue.state,
      name: supportIssue.name,
      account: SupportIssueDtoMapper.mapUserData(supportIssue.userData),
      transaction: SupportIssueDtoMapper.mapTransactionData(supportIssue.transaction, transactionInput),
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

  static mapTransactionData(transaction: Transaction, inputCurrency?: Asset): SupportIssueInternalTransactionDataDto {
    if (!transaction?.id) return undefined;

    const targetEntity = transaction.buyCrypto ?? transaction.buyFiat;

    return {
      id: transaction.id,
      sourceType: transaction.sourceType,
      type: transaction.type,
      amlCheck: transaction.amlCheck,
      amlReason: targetEntity?.amlReason,
      comment: targetEntity?.comment,
      inputAmount: targetEntity?.inputAmount,
      inputAsset: targetEntity?.inputAsset,
      inputBlockchain: inputCurrency?.blockchain,
      outputAmount: targetEntity?.outputAmount,
      outputAsset: targetEntity?.outputAsset.name,
      outputBlockchain: transaction?.buyCrypto?.outputAsset.blockchain,
      wallet: transaction.user?.wallet
        ? {
            name: transaction.user.wallet.displayName ?? transaction.user.wallet.name,
            amlRules: transaction.user.wallet.amlRules,
            isKycClient: transaction.user.wallet.isKycClient,
          }
        : undefined,
      isComplete: targetEntity?.isComplete,
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
