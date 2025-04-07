import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

export enum DEuroAdapterCommands {
  WRAP = 'wrap',
}
@Injectable()
export class DEuroAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly deuroService: DEuroService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.DEURO, liquidityManagementBalanceService, deuroService);

    this.commands.set(DEuroAdapterCommands.WRAP, this.wrap.bind(this));
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'dEURO',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async wrap(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const walletAddress = this.deuroService.getWalletAddress();
    const equityContract = this.deuroService.getEquityContract();
    const depsWrapperContract = this.deuroService.getDEPSWrapperContract();

    const decimals = await depsWrapperContract.decimals();
    const wrapWeiAmount = EvmUtil.toWeiAmount(order.amount, decimals);

    const gasPrice = await this.deuroService.getEvmClient().getRecommendedGasPrice();
    const allowance = await equityContract.allowance(walletAddress, depsWrapperContract.address);

    if (wrapWeiAmount.gt(allowance))
      await equityContract.approve(depsWrapperContract.address, ethers.constants.MaxInt256);

    const result = await depsWrapperContract.depositFor(walletAddress, wrapWeiAmount, {
      gasPrice: gasPrice,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return result.hash;
  }
}
