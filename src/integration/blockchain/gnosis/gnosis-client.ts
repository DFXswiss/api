import { FeeAmount } from '@uniswap/v3-sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class GnosisClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }

  async testSwap(
    _source: Asset,
    _sourceAmount: number,
    _target: Asset,
    _maxSlippage: number,
  ): Promise<{ targetAmount: number; feeAmount: number }> {
    throw new Error('Method not implemented.');
  }

  async testSwapPool(
    _source: Asset,
    _sourceAmount: number,
    _target: Asset,
    _poolFee: FeeAmount,
  ): Promise<{ targetAmount: number; feeAmount: number; priceImpact: number }> {
    throw new Error('Method not implemented.');
  }

  async swap(_sourceToken: Asset, _sourceAmount: number, _targetToken: Asset, _maxSlippage: number): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
