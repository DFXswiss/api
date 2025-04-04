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
    const contract = this.deuroService.getDEPSWrapperContract();

    const decimals = await contract.decimals();
    const wrapWeiAmount = EvmUtil.toWeiAmount(order.amount, decimals);

    // Funktioniert nicht, gasPrice / gasLimit?
    // Tx: 0xb70c7c22946745c73e9262c8e82c0de0e2caad304027a8c0dc686f4e68bd64d7
    // Tx: 0x0697003486070b5b7899866a1acbb020eaab5747113b1cc6643d796803f8e60f
    /*
      {"type":2,"chainId":1,"nonce":4,"maxPriorityFeePerGas":{"type":"BigNumber","hex":"0x59682f00"},"maxFeePerGas":{"type":"BigNumber","hex":"0xef017b0a"},"gasPrice":null,"gasLimit":{"type":"BigNumber","hex":"0x0493e0"},"to":"0x103747924E74708139a9400e4Ab4BEA79FFFA380","value":{"type":"BigNumber","hex":"0x00"},"data":"0x2f4f21e200000000000000000000000002a38f29bea81fdd3887891be013c5f348f76c5d0000000000000000000000000000000000000000000000000de0b6b3a7640000","accessList":[],"hash":"0xb70c7c22946745c73e9262c8e82c0de0e2caad304027a8c0dc686f4e68bd64d7","v":0,"r":"0x4a309a483cb147c928bf11ae55034831b23219fdb63e085dd387cf6a3dca691e","s":"0x7853547fe754c995df1811930e0630668f605dc4c22fed47b0057832c7202427","from":"0x02A38F29bea81FDD3887891bE013c5f348f76C5D","confirmations":0}

      {"type":2,"chainId":1,"nonce":5,"maxPriorityFeePerGas":{"type":"BigNumber","hex":"0x2ca99ab7"},"maxFeePerGas":{"type":"BigNumber","hex":"0x2ca99ab7"},"gasPrice":null,"gasLimit":{"type":"BigNumber","hex":"0x0493e0"},"to":"0x103747924E74708139a9400e4Ab4BEA79FFFA380","value":{"type":"BigNumber","hex":"0x00"},"data":"0x2f4f21e200000000000000000000000002a38f29bea81fdd3887891be013c5f348f76c5d0000000000000000000000000000000000000000000000000de0b6b3a7640000","accessList":[],"hash":"0x0697003486070b5b7899866a1acbb020eaab5747113b1cc6643d796803f8e60f","v":1,"r":"0xa6f4b38c2aea671d2dbd362640cd5b1abe2d2597e4596b5f9e05c6e3744f9e40","s":"0x26b4b9d0a0fbb7a76b043079f8c6625e3ceff856d4abcffa0295a7a185d085bd","from":"0x02A38F29bea81FDD3887891bE013c5f348f76C5D","confirmations":0}
    */
    const gasPrice = await this.deuroService.getEvmClient().getRecommendedGasPrice();

    const result = await contract.depositFor(walletAddress, wrapWeiAmount, {
      gasPrice: gasPrice,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return result.hash;
  }
}
