import { asL2Provider, estimateTotalGasCost } from '@eth-optimism/sdk';
import { BigNumber, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

interface OptimismTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
}

export class OptimismClient extends EvmClient implements L2BridgeEvmClient {
  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    super(http, scanApiUrl, scanApiKey, gatewayUrl, privateKey, dfxAddress, swapContractAddress, swapTokenAddress);
  }

  depositCoinOnDex(amount: number): Promise<string> {
    throw new Error('Method not implemented.');
  }

  withdrawCoinOnDex(amount: number): Promise<string> {
    throw new Error('Method not implemented.');
  }

  depositTokenOnDex(l1token: Asset, amount: number): Promise<string> {
    throw new Error('Method not implemented.');
  }

  withdrawTokenOnDex(l1token: Asset, amount: number): Promise<string> {
    throw new Error('Method not implemented.');
  }

  checkL2TransactionCompletion(l1TxId: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  checkL1TransactionCompletion(l2TxId: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(asL2Provider(this.provider), {
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: 1,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(asL2Provider(this.provider), {
      from: this.dfxAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  /**
   * @overwrite
   */
  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice, l1GasPrice, l1GasUsed, l1FeeScalar } = (await asL2Provider(
      this.provider,
    ).getTransactionReceipt(txHash)) as OptimismTransactionReceipt;

    const actualL2Fee = gasUsed.mul(effectiveGasPrice);
    const actualL1Fee = l1GasUsed.mul(l1GasPrice).mul(l1FeeScalar);

    return this.convertToEthLikeDenomination(actualL2Fee.add(actualL1Fee));
  }

  /**
   * @note
   * requires UniswapV3 implementation or alternative
   */
  async nativeCryptoTestSwap(_nativeCryptoAmount: number, _targetToken: Asset): Promise<number> {
    throw new Error('nativeCryptoTestSwap is not implemented for Optimism blockchain');
  }
}
