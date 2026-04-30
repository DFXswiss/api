import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { OptimismClient } from 'src/integration/blockchain/optimism/optimism-client';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class OptimismL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(ethereumService: EthereumService, optimismService: OptimismService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.OPTIMISM_L2_BRIDGE,
      ethereumService.getDefaultClient<EthereumClient>(),
      optimismService.getDefaultClient<OptimismClient>(),
      assetService,
    );
  }
}
