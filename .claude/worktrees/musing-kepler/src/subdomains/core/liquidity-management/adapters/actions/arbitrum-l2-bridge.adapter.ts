import { Injectable } from '@nestjs/common';
import { ArbitrumClient } from 'src/integration/blockchain/arbitrum/arbitrum-client';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class ArbitrumL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(ethereumService: EthereumService, arbitrumService: ArbitrumService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.ARBITRUM_L2_BRIDGE,
      ethereumService.getDefaultClient<EthereumClient>(),
      arbitrumService.getDefaultClient<ArbitrumClient>(),
      assetService,
    );
  }
}
