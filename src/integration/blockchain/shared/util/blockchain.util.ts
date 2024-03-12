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
  [Blockchain.MONERO]: 'https://xmrscan.org',
  [Blockchain.ETHEREUM]: 'https://etherscan.io',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io',
  [Blockchain.POLYGON]: 'https://polygonscan.com',
  [Blockchain.BASE]: 'https://basescan.org',
  [Blockchain.HAQQ]: 'https://explorer.haqq.network',
  [Blockchain.LIQUID]: 'https://blockstream.info/liquid',
  [Blockchain.CARDANO]: 'https://cardanoscan.io',
};

const TxPaths: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'transactions',
  [Blockchain.BITCOIN]: 'tx',
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.MONERO]: 'tx',
  [Blockchain.ETHEREUM]: 'tx',
  [Blockchain.BINANCE_SMART_CHAIN]: 'tx',
  [Blockchain.OPTIMISM]: 'tx',
  [Blockchain.ARBITRUM]: 'tx',
  [Blockchain.POLYGON]: 'tx',
  [Blockchain.BASE]: 'tx',
  [Blockchain.HAQQ]: 'tx',
  [Blockchain.LIQUID]: 'tx',
  [Blockchain.CARDANO]: 'transaction',
};

function assetPaths(asset: Asset): string | undefined {
  switch (asset.blockchain) {
    case Blockchain.DEFICHAIN:
      return `tokens/${asset.name}`;

    case Blockchain.BITCOIN:
    case Blockchain.LIGHTNING:
    case Blockchain.MONERO:
      return undefined;

    case Blockchain.ETHEREUM:
    case Blockchain.BINANCE_SMART_CHAIN:
    case Blockchain.OPTIMISM:
    case Blockchain.ARBITRUM:
    case Blockchain.POLYGON:
    case Blockchain.BASE:
    case Blockchain.HAQQ:
    case Blockchain.CARDANO:
      return asset.chainId ? `token/${asset.chainId}` : undefined;
  }
}
