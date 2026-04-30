import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum EquityProtocol {
  FRANKENCOIN = 'Frankencoin',
  DEURO = 'DEuro',
  JUICE = 'Juice',
}

export interface EquityPairConfig {
  stableAsset: string;
  equityAsset: string;
  protocol: EquityProtocol;
  blockchain: Blockchain;
}

export interface EquityPairMatch {
  config: EquityPairConfig;
  direction: 'invest' | 'redeem';
}

const EQUITY_PAIRS: EquityPairConfig[] = [
  { stableAsset: 'ZCHF', equityAsset: 'FPS', protocol: EquityProtocol.FRANKENCOIN, blockchain: Blockchain.ETHEREUM },
  { stableAsset: 'dEURO', equityAsset: 'nDEPS', protocol: EquityProtocol.DEURO, blockchain: Blockchain.ETHEREUM },
  { stableAsset: 'JUSD', equityAsset: 'JUICE', protocol: EquityProtocol.JUICE, blockchain: Blockchain.CITREA },
];

export function getEquityPairConfig(sourceAssetName: string, targetAssetName: string): EquityPairMatch | undefined {
  for (const config of EQUITY_PAIRS) {
    if (sourceAssetName === config.stableAsset && targetAssetName === config.equityAsset) {
      return { config, direction: 'invest' };
    }
    if (sourceAssetName === config.equityAsset && targetAssetName === config.stableAsset) {
      return { config, direction: 'redeem' };
    }
  }

  return undefined;
}
