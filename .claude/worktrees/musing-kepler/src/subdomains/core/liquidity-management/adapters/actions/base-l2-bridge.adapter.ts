import { Injectable } from '@nestjs/common';
import { BaseClient } from 'src/integration/blockchain/base/base-client';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { EvmL2BridgeAdapter } from './base/evm-l2-bridge.adapter';

@Injectable()
export class BaseL2BridgeAdapter extends EvmL2BridgeAdapter {
  constructor(ethereumService: EthereumService, baseService: BaseService, assetService: AssetService) {
    super(
      LiquidityManagementSystem.BASE_L2_BRIDGE,
      ethereumService.getDefaultClient<EthereumClient>(),
      baseService.getDefaultClient<BaseClient>(),
      assetService,
    );
  }
}
