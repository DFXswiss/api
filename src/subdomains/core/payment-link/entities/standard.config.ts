import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum PaymentStandard {
  OPEN_CRYPTO_PAY = 'OpenCryptoPay',
  FRANKENCOIN_PAY = 'FrankencoinPay',
  LIGHTNING_BOLT11 = 'LightningBolt11',
  PAY_TO_ADDRESS = 'PayToAddress',
}

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: Blockchain[];
}
