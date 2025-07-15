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
  SOLANA = 'Solana',
  GNOSIS = 'Gnosis',

  // Payment Provider
  BINANCE_PAY = 'BinancePay',

  // Exchanges
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  XT = 'XT',
  MEXC = 'MEXC',

  // Banks
  MAERKI_BAUMANN = 'MaerkiBaumann',
  OLKYPAY = 'Olkypay',
  CHECKOUT = 'Checkout',
  KALEIDO = 'Kaleido',
  SUMIXX = 'Sumixx',
}

export const PaymentLinkBlockchain = {
  ARBITRUM: Blockchain.ARBITRUM,
  BASE: Blockchain.BASE,
  ETHEREUM: Blockchain.ETHEREUM,
  LIGHTNING: Blockchain.LIGHTNING,
  MONERO: Blockchain.MONERO,
  OPTIMISM: Blockchain.OPTIMISM,
  POLYGON: Blockchain.POLYGON,
  GNOSIS: Blockchain.GNOSIS,
  BITCOIN: Blockchain.BITCOIN,
  BINANCE_PAY: Blockchain.BINANCE_PAY,
  SOLANA: Blockchain.SOLANA,
} as const;

export type PaymentLinkBlockchain = (typeof PaymentLinkBlockchain)[keyof typeof PaymentLinkBlockchain];
