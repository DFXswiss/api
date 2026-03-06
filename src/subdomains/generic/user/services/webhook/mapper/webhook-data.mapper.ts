import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import {
  BuyCryptoExtended,
  BuyFiatExtended,
  TransactionDtoMapper,
} from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { KycCompleted, UserData } from '../../../models/user-data/user-data.entity';
import { KycStatus, KycType } from '../../../models/user-data/user-data.enum';
import { AccountChangedWebhookData } from '../dto/account-changed-webhook.dto';
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
      country: userData.country && CountryDtoMapper.entityToDto(userData.country),
      nationality: userData.nationality && CountryDtoMapper.entityToDto(userData.nationality),
      birthday: userData.birthday,
      phone: userData.phone,
      kycStatus: getKycWebhookStatus(userData.kycStatus, userData.kycType),
      kycLevel: userData.kycLevelDisplay,
      kycHash: userData.kycHash,
      tradingLimit: userData.tradingLimit,
    };
  }

  static mapCryptoFiatData(payment: BuyFiatExtended): PaymentWebhookData {
    const inputAsset = payment.inputAssetEntity as Asset;

    return {
      ...TransactionDtoMapper.mapBuyFiatTransactionDetail(payment),
      dfxReference: payment.id,
      sourceChainId: inputAsset.chainId,
      destinationChainId: null,
      sourceEvmChainId: EvmUtil.getChainId(inputAsset.blockchain),
      destinationEvmChainId: null,
      depositAddress: payment.cryptoInput?.address?.address ?? null,
    };
  }

  static mapFiatFiatData(payment: BuyFiatExtended): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransactionDetail(payment),
      dfxReference: payment.id,
      sourceChainId: null,
      destinationChainId: null,
      sourceEvmChainId: null,
      destinationEvmChainId: null,
      depositAddress: null,
    };
  }

  static mapCryptoCryptoData(payment: BuyCryptoExtended): PaymentWebhookData {
    const inputAsset = payment.inputAssetEntity as Asset;
    const outputAsset = payment.outputAsset;

    return {
      ...TransactionDtoMapper.mapBuyCryptoTransactionDetail(payment),
      dfxReference: payment.id,
      sourceChainId: inputAsset.chainId,
      destinationChainId: outputAsset?.chainId ?? null,
      sourceEvmChainId: EvmUtil.getChainId(inputAsset.blockchain),
      destinationEvmChainId: outputAsset?.blockchain ? EvmUtil.getChainId(outputAsset.blockchain) : null,
      depositAddress: payment.cryptoInput?.address?.address ?? null,
    };
  }

  static mapFiatCryptoData(payment: BuyCryptoExtended): PaymentWebhookData {
    const outputAsset = payment.outputAsset;

    return {
      ...TransactionDtoMapper.mapBuyCryptoTransactionDetail(payment),
      dfxReference: payment.id,
      sourceChainId: null,
      destinationChainId: outputAsset?.chainId ?? null,
      sourceEvmChainId: null,
      destinationEvmChainId: outputAsset?.blockchain ? EvmUtil.getChainId(outputAsset.blockchain) : null,
      depositAddress: null,
    };
  }

  static mapAccountMergeData(master: UserData): AccountChangedWebhookData {
    return { accountId: master.id };
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
