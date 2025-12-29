import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { PolygonClient } from 'src/integration/blockchain/polygon/polygon-client';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class PolygonL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(ethereumService: EthereumService, polygonService: PolygonService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.POLYGON_L2_BRIDGE,
      ethereumService.getDefaultClient<EthereumClient>(),
      polygonService.getDefaultClient<PolygonClient>(),
      assetService,
    );
  }
}
