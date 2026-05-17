import { L2Provider, asL2Provider, estimateTotalGasCost } from '@eth-optimism/sdk';
import { BigNumber, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { EvmClient } from './evm-client';
import { EvmUtil } from './evm.util';

interface OpStackTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
  l1Fee: BigNumber;
}

/**
 * Shared base for OP Stack L2 EVM clients (Optimism, Base, ...). Provides the L2-aware
 * gas estimation and fee calculation that uses `@eth-optimism/sdk`. Concrete clients add
 * their own bridge logic on top.
 */
export abstract class OpStackEvmClient extends EvmClient {
  async getCurrentGasCostForCoinTransaction(amount: number): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.walletAddress,
      to: this.randomReceiverAddress,
      value: EvmUtil.toWeiAmount(amount).toString(),
      type: 2,
    });

    return EvmUtil.fromWeiAmount(totalGasCost);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, amount: number): Promise<number> {
    const amountWei = EvmUtil.toWeiAmount(amount, token.decimals);
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.walletAddress,
      to: token.chainId,
      data: EvmUtil.encodeErc20Transfer(this.randomReceiverAddress, amountWei),
      type: 2,
    });

    return EvmUtil.fromWeiAmount(totalGasCost);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const receipt = await this.l2Provider.getTransactionReceipt(txHash);

    const { gasUsed, effectiveGasPrice, l1Fee } = receipt as OpStackTransactionReceipt;

    const l2Fee = gasUsed.mul(effectiveGasPrice);

    return EvmUtil.fromWeiAmount(l1Fee.add(l2Fee));
  }

  protected get l2Provider(): L2Provider<ethers.providers.JsonRpcProvider> {
    return asL2Provider(this.provider);
  }
}
