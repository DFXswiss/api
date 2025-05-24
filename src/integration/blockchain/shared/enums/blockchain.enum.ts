export enum Blockchain {
  BITCOIN = 'Bitcoin',
  LIGHTNING = 'Lightning',
  MONERO = 'Monero',
  ETHEREUM = 'Ethereum',
  BINANCE_SMART_CHAIN = 'BinanceSmartChain',
  OPTIMISM = 'Optimism',
  ARBITRUM = 'Arbitrum',
  POLYGON = 'Polygon',
  BASE = 'Base',
  HAQQ = 'Haqq',
  LIQUID = 'Liquid',
  ARWEAVE = 'Arweave',
  CARDANO = 'Cardano',
  DEFICHAIN = 'DeFiChain',
  RAILGUN = 'Railgun',
  BINANCE_PAY = 'BinancePay',
}

export const PaymentLinkBlockchain = {
  ARBITRUM: Blockchain.ARBITRUM,
  BASE: Blockchain.BASE,
  ETHEREUM: Blockchain.ETHEREUM,
  LIGHTNING: Blockchain.LIGHTNING,
  MONERO: Blockchain.MONERO,
  OPTIMISM: Blockchain.OPTIMISM,
  POLYGON: Blockchain.POLYGON,
  BITCOIN: Blockchain.BITCOIN,
  BINANCE_PAY: Blockchain.BINANCE_PAY,
} as const;

export type PaymentLinkBlockchain = (typeof PaymentLinkBlockchain)[keyof typeof PaymentLinkBlockchain];
