import { Environment, GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../enums/blockchain.enum';

// --- CATEGORIES --- //

export const EvmBlockchains = [
  Blockchain.ETHEREUM,
  Blockchain.SEPOLIA,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.ARBITRUM,
  Blockchain.OPTIMISM,
  Blockchain.POLYGON,
  Blockchain.BASE,
  Blockchain.GNOSIS,
  Blockchain.HAQQ,
  Blockchain.CITREA,
  Blockchain.CITREA_TESTNET,
];

export const TestBlockchains =
  GetConfig().environment === Environment.PRD
    ? [Blockchain.SEPOLIA, Blockchain.CITREA_TESTNET, Blockchain.HAQQ, Blockchain.ARWEAVE]
    : [];

export const PaymentLinkBlockchains = [
  Blockchain.ARBITRUM,
  Blockchain.BASE,
  Blockchain.ETHEREUM,
  Blockchain.SEPOLIA,
  Blockchain.LIGHTNING,
  Blockchain.MONERO,
  Blockchain.OPTIMISM,
  Blockchain.POLYGON,
  Blockchain.GNOSIS,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.BITCOIN,
  Blockchain.ZANO,
  Blockchain.BINANCE_PAY,
  Blockchain.KUCOIN_PAY,
  Blockchain.SOLANA,
  Blockchain.TRON,
  Blockchain.CARDANO,
].filter((b) => !TestBlockchains.includes(b));

// --- EXPLORERS --- //
export function txExplorerUrl(blockchain: Blockchain, txId: string): string | undefined {
  const baseUrl = BlockchainExplorerUrls[blockchain];
  const txPath = TxPaths[blockchain];
  return baseUrl && txPath ? `${baseUrl}/${txPath}/${txId}` : undefined;
}

export function assetExplorerUrl(asset: Asset): string | undefined {
  const explorerUrl = BlockchainExplorerUrls[asset.blockchain];
  return asset.type === AssetType.TOKEN ? `${explorerUrl}/${assetPaths(asset) ?? ''}` : explorerUrl;
}

export function addressExplorerUrl(blockchain: Blockchain, address: string): string | undefined {
  const baseUrl = BlockchainExplorerUrls[blockchain];
  const addressPath = addressPaths(blockchain);
  return baseUrl && addressPath ? `${baseUrl}/${addressPath}/${address}` : undefined;
}

// --- HELPERS --- //

const BlockchainExplorerUrls: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'https://defiscan.live',
  [Blockchain.BITCOIN]: 'https://mempool.space',
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.SPARK]: 'https://sparkscan.io',
  [Blockchain.MONERO]: 'https://xmrscan.org',
  [Blockchain.ZANO]: 'https://explorer.zano.org',
  [Blockchain.ETHEREUM]: 'https://etherscan.io',
  [Blockchain.SEPOLIA]: 'https://sepolia.etherscan.io',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io',
  [Blockchain.POLYGON]: 'https://polygonscan.com',
  [Blockchain.BASE]: 'https://basescan.org',
  [Blockchain.GNOSIS]: 'https://gnosisscan.io',
  [Blockchain.SOLANA]: 'https://solscan.io',
  [Blockchain.TRON]: 'https://tronscan.org/#',
  [Blockchain.CITREA]: 'https://citreascan.com',
  [Blockchain.CITREA_TESTNET]: 'https://testnet.citreascan.com',
  [Blockchain.HAQQ]: 'https://explorer.haqq.network',
  [Blockchain.LIQUID]: 'https://blockstream.info/liquid',
  [Blockchain.ARWEAVE]: 'https://arscan.io',
  [Blockchain.CARDANO]: 'https://cardanoscan.io',
  [Blockchain.RAILGUN]: 'https://railgun-explorer.com',
  [Blockchain.BINANCE_PAY]: undefined,
  [Blockchain.KUCOIN_PAY]: undefined,
  [Blockchain.KRAKEN]: undefined,
  [Blockchain.BINANCE]: undefined,
  [Blockchain.XT]: undefined,
  [Blockchain.MEXC]: undefined,
  [Blockchain.MAERKI_BAUMANN]: undefined,
  [Blockchain.OLKYPAY]: undefined,
  [Blockchain.CHECKOUT]: undefined,
  [Blockchain.SUMIXX]: undefined,
  [Blockchain.YAPEAL]: undefined,
};

const TxPaths: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'transactions',
  [Blockchain.BITCOIN]: 'tx',
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.SPARK]: 'tx',
  [Blockchain.MONERO]: 'tx',
  [Blockchain.ZANO]: 'transaction',
  [Blockchain.ETHEREUM]: 'tx',
  [Blockchain.SEPOLIA]: 'tx',
  [Blockchain.BINANCE_SMART_CHAIN]: 'tx',
  [Blockchain.OPTIMISM]: 'tx',
  [Blockchain.ARBITRUM]: 'tx',
  [Blockchain.POLYGON]: 'tx',
  [Blockchain.BASE]: 'tx',
  [Blockchain.GNOSIS]: 'tx',
  [Blockchain.SOLANA]: 'tx',
  [Blockchain.TRON]: 'transaction',
  [Blockchain.CITREA]: 'tx',
  [Blockchain.CITREA_TESTNET]: 'tx',
  [Blockchain.HAQQ]: 'tx',
  [Blockchain.LIQUID]: 'tx',
  [Blockchain.ARWEAVE]: 'tx',
  [Blockchain.CARDANO]: 'transaction',
  [Blockchain.RAILGUN]: 'transaction',
  [Blockchain.BINANCE_PAY]: undefined,
  [Blockchain.KUCOIN_PAY]: undefined,
  [Blockchain.KRAKEN]: undefined,
  [Blockchain.BINANCE]: undefined,
  [Blockchain.XT]: undefined,
  [Blockchain.MEXC]: undefined,
  [Blockchain.MAERKI_BAUMANN]: undefined,
  [Blockchain.OLKYPAY]: undefined,
  [Blockchain.CHECKOUT]: undefined,
  [Blockchain.SUMIXX]: undefined,
  [Blockchain.YAPEAL]: undefined,
};

function assetPaths(asset: Asset): string | undefined {
  switch (asset.blockchain) {
    case Blockchain.DEFICHAIN:
      return `tokens/${asset.name}`;

    case Blockchain.BITCOIN:
    case Blockchain.LIGHTNING:
    case Blockchain.MONERO:
      return undefined;

    case Blockchain.ZANO:
      return asset.chainId ? `assets?asset_id=${asset.chainId}` : undefined;

    case Blockchain.ETHEREUM:
    case Blockchain.BINANCE_SMART_CHAIN:
    case Blockchain.OPTIMISM:
    case Blockchain.ARBITRUM:
    case Blockchain.POLYGON:
    case Blockchain.BASE:
    case Blockchain.GNOSIS:
    case Blockchain.CITREA:
    case Blockchain.CITREA_TESTNET:
    case Blockchain.SOLANA:
    case Blockchain.HAQQ:
    case Blockchain.CARDANO:
      return asset.chainId ? `token/${asset.chainId}` : undefined;

    case Blockchain.TRON:
      return asset.chainId ? `token20/${asset.chainId}` : undefined;
  }
}

function addressPaths(blockchain: Blockchain): string | undefined {
  switch (blockchain) {
    case Blockchain.LIGHTNING:
    case Blockchain.MONERO:
    case Blockchain.ZANO:
      return undefined;

    case Blockchain.DEFICHAIN:
    case Blockchain.BITCOIN:
    case Blockchain.ETHEREUM:
    case Blockchain.BINANCE_SMART_CHAIN:
    case Blockchain.OPTIMISM:
    case Blockchain.ARBITRUM:
    case Blockchain.POLYGON:
    case Blockchain.BASE:
    case Blockchain.GNOSIS:
    case Blockchain.CITREA:
    case Blockchain.CITREA_TESTNET:
    case Blockchain.TRON:
    case Blockchain.HAQQ:
    case Blockchain.LIQUID:
    case Blockchain.ARWEAVE:
    case Blockchain.CARDANO:
      return 'address';

    case Blockchain.SOLANA:
      return 'account';
  }
}
