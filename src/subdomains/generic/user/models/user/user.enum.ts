export enum UserStatus {
  NA = 'NA',
  ACTIVE = 'Active',
  BLOCKED = 'Blocked',
  DELETED = 'Deleted',
}

export enum UserAddressType {
  BITCOIN_LEGACY = 'BitcoinLegacy',
  BITCOIN_BECH32 = 'BitcoinBech32',
  EVM = 'EVM',
  LN_URL = 'LNURL',
  LN_NID = 'LNNID',
  LND_HUB = 'LNDHUB',
  UMA = 'UMA',
  SPARK = 'Spark',
  MONERO = 'Monero',
  LIQUID = 'Liquid',
  ARWEAVE = 'Arweave',
  RAILGUN = 'Railgun',
  CARDANO = 'Cardano',
  SOLANA = 'Solana',
  TRON = 'Tron',
  ZANO = 'Zano',
  OTHER = 'Other',
}

export enum WalletType {
  METAMASK = 'MetaMask',
  RABBY = 'Rabby',
  TRUST = 'Trust',
  PHANTOM = 'Phantom',
  TRON_LINK = 'TronLink',
  CLI = 'CLI',
  LEDGER = 'Ledger',
  BIT_BOX = 'BitBox',
  TREZOR = 'Trezor',
  ALBY = 'Alby',
  WALLET_CONNECT = 'WalletConnect',
  DFX_TARO = 'DfxTaro',
}
