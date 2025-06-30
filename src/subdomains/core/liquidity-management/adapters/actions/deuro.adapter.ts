import { Injectable } from '@nestjs/common';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

@Injectable()
export class DEuroAdapter extends FrankencoinBasedAdapter {
  protected readonly logger: DfxLogger;

  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    readonly deuroService: DEuroService,
    private readonly assetService: AssetService,
    readonly loggerFactory: LoggerFactory,
  ) {
    super(LiquidityManagementSystem.DEURO, liquidityManagementBalanceService, deuroService);

    this.logger = this.loggerFactory.create(DEuroAdapter);
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'dEURO',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  async getEquityToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'nDEPS',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }
}
