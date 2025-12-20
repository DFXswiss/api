import { Injectable } from '@nestjs/common';
import { BigNumber, ethers } from 'ethers';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { EvmUtil } from '../evm/evm.util';

export interface TxValidationResult {
  isValid: boolean;
  error?: string;
  sender?: string;
}

@Injectable()
export class TxValidationService {
  validateEvmTransaction(
    hex: string,
    expectedRecipient: string,
    expectedAmount: number,
    expectedAsset: Asset,
  ): TxValidationResult {
    try {
      const parsedTx = ethers.utils.parseTransaction(hex);
      const sender = parsedTx.from?.toLowerCase() ?? '';
      const expectedAmountWei = EvmUtil.toWeiAmount(expectedAmount, expectedAsset.decimals);

      const { recipient, amount } =
        expectedAsset.type === AssetType.COIN
          ? this.parseNativeTransfer(parsedTx)
          : this.parseErc20Transfer(parsedTx, expectedAsset);

      if (!recipient) {
        throw new Error('Transaction has no recipient');
      }

      if (recipient !== expectedRecipient.toLowerCase()) {
        throw new Error(`Invalid recipient: expected ${expectedRecipient}, got ${recipient}`);
      }

      if (amount.lt(expectedAmountWei)) {
        throw new Error(`Insufficient amount: expected ${expectedAmountWei.toString()}, got ${amount.toString()}`);
      }

      return { isValid: true, sender };
    } catch (e) {
      return {
        isValid: false,
        error: e.message,
      };
    }
  }

  private parseNativeTransfer(parsedTx: ethers.Transaction): { recipient?: string; amount?: BigNumber } {
    const recipient = parsedTx.to?.toLowerCase();
    const amount = parsedTx.value;

    return { recipient, amount };
  }

  private parseErc20Transfer(parsedTx: ethers.Transaction, asset: Asset): { recipient?: string; amount?: BigNumber } {
    if (!asset.chainId) {
      throw new Error('Asset has no chainId (contract address)');
    }

    const tokenContract = parsedTx.to?.toLowerCase();

    if (tokenContract !== asset.chainId.toLowerCase()) {
      throw new Error(`Invalid token contract: expected ${asset.chainId}, got ${tokenContract}`);
    }

    const data = parsedTx.data;

    if (!EvmUtil.isErc20Transfer(data)) {
      throw new Error('Transaction is not an ERC20 transfer');
    }

    const { to: recipient, amount } = EvmUtil.decodeErc20Transfer(data);
    return { recipient, amount };
  }
}
