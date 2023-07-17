import { ChainId } from '@uniswap/sdk-core';
import { Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import UNISWAP_ROUTER_02_ABI from 'src/integration/blockchain/shared/evm/abi/uniswap-router02.abi.json';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class BscClient extends EvmClient {
  private routerV2: Contract;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    chainId: ChainId,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, gatewayUrl, privateKey);

    // old v2 router
    this.routerV2 = new ethers.Contract(
      GetConfig().blockchain.bsc.pancakeRouterAddress,
      UNISWAP_ROUTER_02_ABI,
      this.wallet,
    );
  }

  async testSwap(sourceToken: Asset, sourceAmount: number, targetToken: Asset): Promise<number> {
    const sourceContract = new ethers.Contract(sourceToken.chainId, ERC20_ABI, this.wallet);
    const sourceTokenDecimals = await sourceContract.decimals();

    const targetContract = new ethers.Contract(targetToken.chainId, ERC20_ABI, this.wallet);
    const targetTokenDecimals = await targetContract.decimals();

    const inputAmount = this.toWeiAmount(sourceAmount, sourceTokenDecimals);
    const outputAmounts = await this.routerV2.getAmountsOut(inputAmount, [sourceToken.chainId, targetToken.chainId]);

    return this.fromWeiAmount(outputAmounts[1], targetTokenDecimals);
  }
}
