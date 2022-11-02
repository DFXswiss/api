export enum Blockchain {
  DEFICHAIN = 'DeFiChain',
  BITCOIN = 'Bitcoin',
  ETHEREUM = 'Ethereum',
  BINANCE_SMART_CHAIN = 'BinanceSmartChain',
}

export const BlockchainExplorerUrls = {
  [Blockchain.DEFICHAIN]: 'https://defiscan.live/transactions',
  [Blockchain.BITCOIN]: 'https://blockstream.info/tx',
  [Blockchain.ETHEREUM]: 'https://etherscan.io/tx',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com/tx',
};
