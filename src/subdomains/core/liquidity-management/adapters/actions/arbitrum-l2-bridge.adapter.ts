import { Injectable } from '@nestjs/common';
import { ArbitrumClient } from 'src/integration/blockchain/arbitrum/arbitrum-client';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class ArbitrumL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(arbitrumService: ArbitrumService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.ARBITRUM_L2_BRIDGE,
      arbitrumService.getDefaultClient<ArbitrumClient>(),
      assetService,
    );
  }
}
