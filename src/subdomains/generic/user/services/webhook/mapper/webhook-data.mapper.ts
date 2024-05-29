import {
  BuyCryptoExtended,
  BuyFiatExtended,
  TransactionDtoMapper,
} from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { KycCompleted, KycStatus, KycType, UserData } from '../../../models/user-data/user-data.entity';
import { AccountMergeWebhookData } from '../dto/account-merge-webhook.dto';
import { KycWebhookData, KycWebhookStatus } from '../dto/kyc-webhook.dto';
import { PaymentWebhookData } from '../dto/payment-webhook.dto';

export class WebhookDataMapper {
  static mapKycData(userData: UserData): KycWebhookData {
    return {
      mail: userData.mail,
      firstName: userData.firstname,
      lastName: userData.surname,
      street: userData.street,
      houseNumber: userData.houseNumber,
      city: userData.location,
      zip: userData.zip,
      phone: userData.phone,
      kycStatus: getKycWebhookStatus(userData.kycStatus, userData.kycType),
      kycLevel: userData.kycLevelDisplay,
      kycHash: userData.kycHash,
      tradingLimit: userData.tradingLimit,
    };
  }

  static mapCryptoFiatData(payment: BuyFiatExtended): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransactionDetail(payment),
      dfxReference: payment.id,
    };
  }

  static mapFiatFiatData(payment: BuyFiatExtended): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransactionDetail(payment),
      dfxReference: payment.id,
    };
  }

  static mapCryptoCryptoData(payment: BuyCryptoExtended): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransactionDetail(payment),
      dfxReference: payment.id,
    };
  }

  static mapFiatCryptoData(payment: BuyCryptoExtended): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransactionDetail(payment),
      dfxReference: payment.id,
    };
  }

  static mapAccountMergeData(master: UserData, slave: UserData): AccountMergeWebhookData {
    return { master: master.id, slave: slave.id };
  }
}

export function getKycWebhookStatus(kycStatus: KycStatus, kycType: KycType): KycWebhookStatus {
  if (KycCompleted(kycStatus)) {
    return kycType === KycType.LOCK ? KycWebhookStatus.LIGHT : KycWebhookStatus.FULL;
  } else if (kycStatus === KycStatus.REJECTED) {
    return KycWebhookStatus.REJECTED;
  } else {
    return KycWebhookStatus.NA;
  }
}
