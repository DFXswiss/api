import { Environment } from 'src/config/config';
import { Blockchain, PaymentLinkBlockchain } from './blockchain.enum';

// Blockchains that are only available in development environments (LOC and DEV)
export const DEVELOPMENT_ONLY_BLOCKCHAINS: Blockchain[] = [
  Blockchain.SEPOLIA,
  Blockchain.HAQQ,
  Blockchain.ARWEAVE,
  Blockchain.CITREA_TESTNET,
];

export function isBlockchainEnabled(blockchain: Blockchain, environment: Environment): boolean {
  // If it's a development-only blockchain, only enable it in LOC and DEV environments
  if (DEVELOPMENT_ONLY_BLOCKCHAINS.includes(blockchain)) {
    return environment === Environment.LOC || environment === Environment.DEV;
  }
  
  // All other blockchains are enabled in all environments
  return true;
}

export function getEnabledBlockchains(environment: Environment): Blockchain[] {
  return Object.values(Blockchain).filter(blockchain => 
    isBlockchainEnabled(blockchain, environment)
  );
}

export function getEnabledPaymentLinkBlockchains(environment: Environment): PaymentLinkBlockchain[] {
  const allPaymentLinkBlockchains = Object.values(PaymentLinkBlockchain);

  return allPaymentLinkBlockchains.filter(blockchain =>
    isBlockchainEnabled(blockchain, environment)
  ) as PaymentLinkBlockchain[];
}