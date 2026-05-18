import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';

export const REALUNIT_WALLET_NAME = 'RealUnit';

// AmlReasons for which RealUnit-wallet customers are contacted by phone instead of email
// (the corresponding pending mails are not sent in BuyCryptoNotificationService.pendingBuyCrypto and BuyFiatNotificationService.pendingBuyFiat)
export const REALUNIT_DISABLED_PENDING_REASONS: AmlReason[] = [
  AmlReason.MONTHLY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.KYC_DATA_NEEDED,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.ASSET_KYC_NEEDED,
  AmlReason.BANK_RELEASE_PENDING,
  AmlReason.OLKY_NO_KYC,
  AmlReason.BANK_TX_NEEDED,
];
