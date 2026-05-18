import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Organization } from '../user/models/organization/organization.entity';
import { UserData } from '../user/models/user-data/user-data.entity';
import { Wallet } from '../user/models/wallet/wallet.entity';
import {
  CountrySupportInfo,
  LanguageSupportInfo,
  OrganizationSupportInfo,
  UserDataDetailDto,
  WalletSupportInfo,
} from './dto/user-data-support.dto';

export function toCountryDto(country: Country | undefined): CountrySupportInfo | undefined {
  return country && { name: country.name, symbol: country.symbol };
}

export function toLanguageDto(language: Language | undefined): LanguageSupportInfo | undefined {
  return language && { name: language.name, symbol: language.symbol };
}

export function toWalletDto(wallet: Wallet | undefined): WalletSupportInfo | undefined {
  return wallet && { name: wallet.name };
}

export function toOrganizationDto(org: Organization | undefined): OrganizationSupportInfo | undefined {
  if (!org) return undefined;
  return {
    id: org.id,
    name: org.name,
    street: org.street,
    houseNumber: org.houseNumber,
    zip: org.zip,
    location: org.location,
    country: toCountryDto(org.country),
    legalEntity: org.legalEntity,
    signatoryPower: org.signatoryPower,
    complexOrgStructure: org.complexOrgStructure,
    allBeneficialOwnersName: org.allBeneficialOwnersName,
    allBeneficialOwnersDomicile: org.allBeneficialOwnersDomicile,
    accountOpenerAuthorization: org.accountOpenerAuthorization,
  };
}

export function toUserDataDetailDto(u: UserData): UserDataDetailDto {
  return {
    id: u.id,
    created: u.created,
    status: u.status,
    riskStatus: u.riskStatus,
    kycStatus: u.kycStatus,
    kycLevel: u.kycLevel,
    depositLimit: u.depositLimit,
    wallet: toWalletDto(u.wallet),

    accountType: u.accountType,
    mail: u.mail,
    verifiedName: u.verifiedName,
    verifiedCountry: toCountryDto(u.verifiedCountry),
    firstname: u.firstname,
    surname: u.surname,
    street: u.street,
    houseNumber: u.houseNumber,
    zip: u.zip,
    location: u.location,
    country: toCountryDto(u.country),
    nationality: toCountryDto(u.nationality),
    language: toLanguageDto(u.language),
    birthday: u.birthday,
    phone: u.phone,

    organization: toOrganizationDto(u.organization),

    kycType: u.kycType,
    kycHash: u.kycHash,
    kycFileId: u.kycFileId,
    identDocumentId: u.identDocumentId,
    identDocumentType: u.identDocumentType,
    identificationType: u.identificationType,
    highRisk: u.highRisk,
    pep: u.pep,
    bankTransactionVerification: u.bankTransactionVerification,
    olkypayAllowed: u.olkypayAllowed,

    paymentLinksAllowed: u.paymentLinksAllowed,
    paymentLinksConfig: u.paymentLinksConfig,
    paymentLinksName: u.paymentLinksName,

    phoneCallStatus: u.phoneCallStatus,
    phoneCallAccepted: u.phoneCallAccepted,
    phoneCallCheckDate: u.phoneCallCheckDate,
    phoneCallExternalAccountCheckDate: u.phoneCallExternalAccountCheckDate,
    phoneCallExternalAccountCheckValues: u.phoneCallExternalAccountCheckValues,
    phoneCallIpCheckDate: u.phoneCallIpCheckDate,
    phoneCallIpCountryCheckDate: u.phoneCallIpCountryCheckDate,
    phoneCallTimes: u.phoneCallTimes,

    buyVolume: u.buyVolume,
    annualBuyVolume: u.annualBuyVolume,
    sellVolume: u.sellVolume,
    annualSellVolume: u.annualSellVolume,
    cryptoVolume: u.cryptoVolume,
    annualCryptoVolume: u.annualCryptoVolume,

    isTrustedReferrer: u.isTrustedReferrer,
    tradeApprovalDate: u.tradeApprovalDate,
    deactivationDate: u.deactivationDate,
    lastNameCheckDate: u.lastNameCheckDate,
    letterSentDate: u.letterSentDate,
    moderator: u.moderator,
  };
}
