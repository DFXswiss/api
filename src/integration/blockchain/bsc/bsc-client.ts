import { Contract, BigNumber as EthersNumber, ethers } from 'ethers';
import { Config } from 'src/config/config';
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

  async getRecommendedGasPrice(): Promise<EthersNumber> {
    return Config.blockchain.bsc.gasPrice
      ? EthersNumber.from(Config.blockchain.bsc.gasPrice)
      : // 80% additional cap
        super.getRecommendedGasPrice().then((p) => p.mul(20).div(12));
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
