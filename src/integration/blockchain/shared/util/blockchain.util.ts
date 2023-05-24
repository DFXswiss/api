import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../enums/blockchain.enum';

export function txExplorerUrl(blockchain: Blockchain, txId: string): string {
  return `${BlockchainExplorerUrls[blockchain]}/${TxPaths[blockchain]}/${txId}`;
}

export function assetExplorerUrl(asset: Asset): string | undefined {
  if (asset.type === AssetType.COIN) return undefined;

  const assetPath = assetPaths(asset);
  return assetPath ? `${BlockchainExplorerUrls[asset.blockchain]}/${assetPath}` : undefined;
}

// --- HELPERS --- //

export const BlockchainExplorerUrls: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'https://defiscan.live/transactions',
  [Blockchain.BITCOIN]: 'https://blockstream.info/tx',
  [Blockchain.LIGHTNING]: 'https://blockstream.info/tx',
  [Blockchain.ETHEREUM]: 'https://etherscan.io/tx',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com/tx',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io/tx',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io/tx',
  [Blockchain.POLYGON]: 'https://polygonscan.com/tx',
  [Blockchain.CARDANO]: 'https://cardanoscan.io/transaction',
};

const TxPaths: { [b in Blockchain]: string } = {
  [Blockchain.DEFICHAIN]: 'transactions',
  [Blockchain.BITCOIN]: 'tx',
  [Blockchain.LIGHTNING]: 'tx',
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
