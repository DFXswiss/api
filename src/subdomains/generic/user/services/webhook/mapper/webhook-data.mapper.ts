import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { TransactionDtoMapper } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { KycCompleted, KycStatus, KycType, UserData } from '../../../models/user-data/user-data.entity';
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
      kycLevel: userData.kycLevel,
      kycHash: userData.kycHash,
      tradingLimit: userData.tradingLimit,
    };
  }

  static mapCryptoFiatData(payment: BuyFiat): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.bankTx?.iban,
    };
  }

  static mapFiatFiatData(payment: BuyFiat): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.bankTx?.iban,
    };
  }

  static mapCryptoCryptoData(payment: BuyCrypto): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.user?.address,
    };
  }

  static mapFiatCryptoData(payment: BuyCrypto): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: payment.bankTx?.iban,
      targetAccount: payment.user?.address,
    };
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
