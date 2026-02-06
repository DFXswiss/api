import { Injectable } from '@nestjs/common';
import { JuiceService } from 'src/integration/blockchain/juice/juice.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter, FrankencoinBasedAdapterCommands } from './base/frankencoin-based.adapter';

@Injectable()
export class JuiceAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    readonly juiceService: JuiceService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.JUICE, liquidityManagementBalanceService, juiceService);

    // Juice doesn't have a wrapper contract
    this.commands.delete(FrankencoinBasedAdapterCommands.WRAP);
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'JUSD',
      type: AssetType.TOKEN,
      blockchain: Blockchain.CITREA,
    });
  }

  async getEquityToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'JUICE',
      type: AssetType.TOKEN,
      blockchain: Blockchain.CITREA,
    });
  }
}
