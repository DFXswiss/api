import { Injectable } from '@nestjs/common';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

@Injectable()
export class FrankencoinAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    frankencoinService: FrankencoinService,
    assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.FRANKENCOIN, liquidityManagementBalanceService, frankencoinService, assetService);
  }
}
