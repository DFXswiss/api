import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../enums/blockchain.enum';

export function txExplorerUrl(blockchain: Blockchain, txId: string): string | undefined {
  const baseUrl = BlockchainExplorerUrls[blockchain];
  const txPath = TxPaths[blockchain];
  return baseUrl && txPath ? `${baseUrl}/${txPath}/${txId}` : undefined;
}

export function assetExplorerUrl(asset: Asset): string | undefined {
  const explorerUrl = BlockchainExplorerUrls[asset.blockchain];
  return asset.type === AssetType.COIN ? explorerUrl : `${explorerUrl}/${assetPaths(asset) ?? ''}`;
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
  [Blockchain.MONERO]: 'https://xmrscan.org',
  [Blockchain.ETHEREUM]: 'https://etherscan.io',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io',
  [Blockchain.POLYGON]: 'https://polygonscan.com',
  [Blockchain.BASE]: 'https://basescan.org',
  [Blockchain.HAQQ]: 'https://explorer.haqq.network',
  [Blockchain.LIQUID]: 'https://blockstream.info/liquid',
  [Blockchain.ARWEAVE]: 'https://arscan.io',
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
  [Blockchain.ARWEAVE]: 'tx',
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

function addressPaths(blockchain: Blockchain): string | undefined {
  switch (blockchain) {
    case Blockchain.LIGHTNING:
    case Blockchain.MONERO:
      return undefined;

    case Blockchain.DEFICHAIN:
    case Blockchain.BITCOIN:
    case Blockchain.ETHEREUM:
    case Blockchain.BINANCE_SMART_CHAIN:
    case Blockchain.OPTIMISM:
    case Blockchain.ARBITRUM:
    case Blockchain.POLYGON:
    case Blockchain.BASE:
    case Blockchain.HAQQ:
    case Blockchain.LIQUID:
    case Blockchain.ARWEAVE:
    case Blockchain.CARDANO:
      return 'address';
  }
}
