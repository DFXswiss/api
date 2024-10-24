import { Contract, ethers } from 'ethers';
import UNISWAP_ROUTER_02_ABI from 'src/integration/blockchain/shared/evm/abi/uniswap-router02.abi.json';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';

export class BscClient extends EvmClient {
  private readonly routerV2: Contract;

  constructor(params: EvmClientParams) {
    super(params);

    // old v2 router
    this.routerV2 = new ethers.Contract(params.swapContractAddress, UNISWAP_ROUTER_02_ABI, this.wallet);
  }

  async testSwap(
    sourceToken: Asset,
    sourceAmount: number,
    targetToken: Asset,
  ): Promise<{ targetAmount: number; feeAmount: number }> {
    const inputAmount = EvmUtil.toWeiAmount(sourceAmount, sourceToken.decimals);
    const outputAmounts = await this.routerV2.getAmountsOut(inputAmount, [sourceToken.chainId, targetToken.chainId]);

    return { targetAmount: EvmUtil.fromWeiAmount(outputAmounts[1], targetToken.decimals), feeAmount: 0 };
  }
}
