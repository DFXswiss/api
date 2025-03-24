import { Injectable } from '@nestjs/common';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

@Injectable()
export class DEuroAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    deuroService: DEuroService,
    liquidityManagementOrderRepo: LiquidityManagementOrderRepository,
    private readonly assetService: AssetService,
  ) {
    super(
      LiquidityManagementSystem.DEURO,
      liquidityManagementBalanceService,
      deuroService,
      liquidityManagementOrderRepo,
    );
  }

  get priceSource(): string {
    return 'dEURO';
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'DEURO',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }
}
