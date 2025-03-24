import { Injectable } from '@nestjs/common';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

@Injectable()
export class FrankencoinAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    frankencoinService: FrankencoinService,
    liquidityManagementOrderRepo: LiquidityManagementOrderRepository,
    private readonly assetService: AssetService,
  ) {
    super(
      LiquidityManagementSystem.FRANKENCOIN,
      liquidityManagementBalanceService,
      frankencoinService,
      liquidityManagementOrderRepo,
    );
  }

  get priceSource(): string {
    return 'Frankencoin';
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'ZCHF',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }
}
