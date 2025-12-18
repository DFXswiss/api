import { Injectable } from '@nestjs/common';
import { BigNumber, ethers } from 'ethers';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { EvmUtil } from '../evm/evm.util';

export interface TxValidationResult {
  isValid: boolean;
  sender?: string;
  recipient?: string;
  amount?: BigNumber;
  error?: string;
}

@Injectable()
export class TxValidationService {
  validateEvmTransaction(
    hex: string,
    expectedRecipient: string,
    expectedAmount: number,
    asset: Asset,
  ): TxValidationResult {
    try {
      const parsedTx = ethers.utils.parseTransaction(hex);
      const sender = parsedTx.from?.toLowerCase() ?? '';
      const expectedAmountWei = EvmUtil.toWeiAmount(expectedAmount, asset.decimals);

      const result =
        asset.type === AssetType.COIN
          ? this.validateNativeTransfer(parsedTx, expectedRecipient, expectedAmountWei)
          : this.validateErc20Transfer(parsedTx, expectedRecipient, expectedAmountWei, asset);

      return { ...result, sender };
    } catch (e) {
      return {
        isValid: false,
        error: `Failed to parse transaction: ${e.message}`,
      };
    }
  }

  private validateNativeTransfer(
    parsedTx: ethers.Transaction,
    expectedRecipient: string,
    expectedAmount: BigNumber,
  ): TxValidationResult {
    const recipient = parsedTx.to?.toLowerCase();
    const amount = parsedTx.value;

    if (!recipient) {
      return { isValid: false, error: 'Transaction has no recipient' };
    }

    if (recipient !== expectedRecipient.toLowerCase()) {
      return {
        isValid: false,
        recipient,
        amount,
        error: `Invalid recipient: expected ${expectedRecipient}, got ${recipient}`,
      };
    }

    if (amount.lt(expectedAmount)) {
      return {
        isValid: false,
        recipient,
        amount,
        error: `Insufficient amount: expected ${expectedAmount.toString()}, got ${amount.toString()}`,
      };
    }

    return { isValid: true, recipient, amount };
  }

  private validateErc20Transfer(
    parsedTx: ethers.Transaction,
    expectedRecipient: string,
    expectedAmount: BigNumber,
    asset: Asset,
  ): TxValidationResult {
    const tokenContract = parsedTx.to?.toLowerCase();
    const data = parsedTx.data;

    if (!asset.chainId) {
      return { isValid: false, error: 'Asset has no chainId (contract address)' };
    }

    if (tokenContract !== asset.chainId.toLowerCase()) {
      return {
        isValid: false,
        error: `Invalid token contract: expected ${asset.chainId}, got ${tokenContract}`,
      };
    }

    if (!EvmUtil.isErc20Transfer(data)) {
      return { isValid: false, error: 'Transaction is not an ERC20 transfer' };
    }

    try {
      const { to: recipient, amount } = EvmUtil.decodeErc20Transfer(data);

      if (recipient !== expectedRecipient.toLowerCase()) {
        return {
          isValid: false,
          recipient,
          amount,
          error: `Invalid recipient: expected ${expectedRecipient}, got ${recipient}`,
        };
      }

      if (amount.lt(expectedAmount)) {
        return {
          isValid: false,
          recipient,
          amount,
          error: `Insufficient amount: expected ${expectedAmount.toString()}, got ${amount.toString()}`,
        };
      }

      return { isValid: true, recipient, amount };
    } catch (e) {
      return { isValid: false, error: `Failed to decode transfer data: ${e.message}` };
    }
  }
}
