export enum Blockchain {
  BITCOIN = 'Bitcoin',
  LIGHTNING = 'Lightning',
  SPARK = 'Spark',
  ARKADE = 'Arkade',
  FIRO = 'Firo',
  MONERO = 'Monero',
  ZANO = 'Zano',
  ETHEREUM = 'Ethereum',
  SEPOLIA = 'Sepolia',
  BINANCE_SMART_CHAIN = 'BinanceSmartChain',
  OPTIMISM = 'Optimism',
  ARBITRUM = 'Arbitrum',
  POLYGON = 'Polygon',
  BASE = 'Base',
  HAQQ = 'Haqq',
  LIQUID = 'Liquid',
  ARWEAVE = 'Arweave',
  CARDANO = 'Cardano',
  INTERNET_COMPUTER = 'InternetComputer',
  DEFICHAIN = 'DeFiChain',
  RAILGUN = 'Railgun',
  SOLANA = 'Solana',
  GNOSIS = 'Gnosis',
  TRON = 'Tron',
  CITREA = 'Citrea',
  CITREA_TESTNET = 'CitreaTestnet',
  BITCOIN_TESTNET4 = 'BitcoinTestnet4',

  // Payment Provider
  BINANCE_PAY = 'BinancePay',
  KUCOIN_PAY = 'KucoinPay',

  // Exchanges
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  XT = 'XT',
  MEXC = 'MEXC',

  // Banks
  MAERKI_BAUMANN = 'MaerkiBaumann',
  OLKYPAY = 'Olkypay',
  OLKY_FROZEN = 'OlkyFrozen',
  CHECKOUT = 'Checkout',
  SUMIXX = 'Sumixx',
  YAPEAL = 'Yapeal',
  FRICK = 'Frick',
}

/**
 * Networks that mirror a mainnet's tickers without carrying its value: `BitcoinTestnet4/BTC`,
 * `Sepolia/ETH`, `Sepolia/USDT` and `Sepolia/ZCHF` all share their `name` with the real thing.
 *
 * Deliberately not `TestBlockchains` from `blockchain.util`: that list is environment-dependent and
 * additionally names mainnets that are merely not enabled in production. Whether a testnet coin is
 * the same good as its mainnet namesake does not depend on the environment — it never is.
 */
export const TestnetBlockchains: Blockchain[] = [
  Blockchain.SEPOLIA,
  Blockchain.CITREA_TESTNET,
  Blockchain.BITCOIN_TESTNET4,
];
