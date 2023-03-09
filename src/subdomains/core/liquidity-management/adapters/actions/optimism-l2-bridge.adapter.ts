import { Injectable } from '@nestjs/common';
import { OptimismClient } from 'src/integration/blockchain/optimism/optimism-client';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class OptimismL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(optimismService: OptimismService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.OPTIMISM_L2_BRIDGE,
      optimismService.getDefaultClient<OptimismClient>(),
      assetService,
    );
  }
}
