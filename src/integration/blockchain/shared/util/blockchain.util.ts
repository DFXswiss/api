import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../enums/blockchain.enum';

export function txExplorerUrl(blockchain: Blockchain, txId: string): string | undefined {
  const baseUrl = BlockchainExplorerUrls[blockchain];
  const txPath = TxPaths[blockchain];
  return baseUrl && txPath ? `${baseUrl}/${txPath}/${txId}` : undefined;
}

export function assetExplorerUrl(asset: Asset): string | undefined {
  if (asset.type === AssetType.COIN) return undefined;

  const assetPath = assetPaths(asset);
  return assetPath ? `${BlockchainExplorerUrls[asset.blockchain]}/${assetPath}` : undefined;
}

// --- HELPERS --- //

const BlockchainExplorerUrls: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'https://defiscan.live',
  [Blockchain.BITCOIN]: 'https://explorer.lightning.space',
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.ETHEREUM]: 'https://etherscan.io',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io',
  [Blockchain.POLYGON]: 'https://polygonscan.com',
  [Blockchain.CARDANO]: 'https://cardanoscan.io',
};

const TxPaths: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'transactions',
  [Blockchain.BITCOIN]: 'tx',
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.ETHEREUM]: 'tx',
  [Blockchain.BINANCE_SMART_CHAIN]: 'tx',
  [Blockchain.OPTIMISM]: 'tx',
  [Blockchain.ARBITRUM]: 'tx',
  [Blockchain.POLYGON]: 'tx',
  [Blockchain.CARDANO]: 'transaction',
};

function assetPaths(asset: Asset): string | undefined {
  switch (asset.blockchain) {
    case Blockchain.DEFICHAIN:
      return `tokens/${asset.name}`;

    case Blockchain.BITCOIN:
    case Blockchain.LIGHTNING:
      return undefined;

    case Blockchain.ETHEREUM:
    case Blockchain.BINANCE_SMART_CHAIN:
    case Blockchain.OPTIMISM:
    case Blockchain.ARBITRUM:
    case Blockchain.POLYGON:
      return asset.chainId ? `address/${asset.chainId}` : undefined;

    case Blockchain.CARDANO:
      return asset.chainId ? `token/${asset.chainId}` : undefined;
  }
}
