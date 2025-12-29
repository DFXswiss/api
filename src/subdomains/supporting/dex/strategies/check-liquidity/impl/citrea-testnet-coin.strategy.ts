import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexCitreaTestnetService } from '../../../services/dex-citrea-testnet.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class CitreaTestnetCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly assetService: AssetService,
    dexCitreaTestnetService: DexCitreaTestnetService,
  ) {
    super(dexCitreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaTestnetCoin();
  }
}
