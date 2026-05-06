import { Injectable } from '@nestjs/common';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { JuiceService } from 'src/integration/blockchain/juice/juice.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FrankencoinBasedService } from 'src/integration/blockchain/shared/frankencoin/frankencoin-based.service';

export interface EquityPairConfig {
  stableAsset: string;
  equityAsset: string;
  service: FrankencoinBasedService;
  blockchain: Blockchain;
}

export interface EquityPairMatch {
  config: EquityPairConfig;
  direction: 'mint' | 'redeem';
}

@Injectable()
export class EquityPairService {
  private readonly pairs: EquityPairConfig[];

  constructor(
    private readonly frankencoinService: FrankencoinService,
    private readonly deuroService: DEuroService,
    private readonly juiceService: JuiceService,
  ) {
    this.pairs = [this.frankencoinService, this.deuroService, this.juiceService].map((s) => ({
      stableAsset: s.stableTokenName,
      equityAsset: s.equityTokenName,
      service: s,
      blockchain: s.blockchain,
    }));
  }

  getEquityPairConfig(sourceAssetName: string, targetAssetName: string): EquityPairMatch | undefined {
    for (const config of this.pairs) {
      if (sourceAssetName === config.stableAsset && targetAssetName === config.equityAsset) {
        return { config, direction: 'mint' };
      }
      if (sourceAssetName === config.equityAsset && targetAssetName === config.stableAsset) {
        return { config, direction: 'redeem' };
      }
    }

    return undefined;
  }
}
