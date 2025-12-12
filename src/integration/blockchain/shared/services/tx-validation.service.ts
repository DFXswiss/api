import { BadRequestException, Injectable } from '@nestjs/common';
import { ethers, BigNumber } from 'ethers';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { EvmUtil } from '../evm/evm.util';

export interface TxValidationResult {
  isValid: boolean;
  recipient?: string;
  amount?: BigNumber;
  error?: string;
}

@Injectable()
export class TxValidationService {
  /**
   * Validates an EVM transaction hex against expected recipient and amount.
   * Supports both native token transfers and ERC20 token transfers.
   */
  validateEvmTransaction(
    hex: string,
    expectedRecipient: string,
    expectedAmount: BigNumber,
    asset: Asset,
  ): TxValidationResult {
    try {
      const parsedTx = ethers.utils.parseTransaction(hex);

      // Native token transfer (ETH, MATIC, etc.)
      if (asset.type === AssetType.COIN) {
        return this.validateNativeTransfer(parsedTx, expectedRecipient, expectedAmount);
      }

      // ERC20 token transfer
      return this.validateErc20Transfer(parsedTx, expectedRecipient, expectedAmount, asset);
    } catch (e) {
      return {
        isValid: false,
        error: `Failed to parse transaction: ${e.message}`,
      };
    }
  }

  /**
   * Validates a native token transfer (ETH, MATIC, etc.)
   */
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

  /**
   * Validates an ERC20 token transfer.
   * The transaction should call the token contract's transfer(address,uint256) function.
   */
  private validateErc20Transfer(
    parsedTx: ethers.Transaction,
    expectedRecipient: string,
    expectedAmount: BigNumber,
    asset: Asset,
  ): TxValidationResult {
    const tokenContract = parsedTx.to?.toLowerCase();
    const data = parsedTx.data;

    // Verify the transaction is calling the correct token contract
    if (!asset.chainId) {
      return { isValid: false, error: 'Asset has no chainId (contract address)' };
    }

    if (tokenContract !== asset.chainId.toLowerCase()) {
      return {
        isValid: false,
        error: `Invalid token contract: expected ${asset.chainId}, got ${tokenContract}`,
      };
    }

    // Verify it's a transfer call
    if (!EvmUtil.isErc20Transfer(data)) {
      return { isValid: false, error: 'Transaction is not an ERC20 transfer' };
    }

    // Decode the transfer data: transfer(address to, uint256 amount)
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

  /**
   * Extracts transaction details from an EVM hex without validation.
   * Useful for getting recipient, amount, and sender from any transaction.
   */
  parseEvmTransaction(hex: string, asset: Asset): { sender: string; recipient: string; amount: BigNumber } | null {
    try {
      const parsedTx = ethers.utils.parseTransaction(hex);
      const sender = parsedTx.from?.toLowerCase() ?? '';

      if (asset.type === AssetType.COIN) {
        return {
          sender,
          recipient: parsedTx.to?.toLowerCase() ?? '',
          amount: parsedTx.value,
        };
      }

      if (EvmUtil.isErc20Transfer(parsedTx.data)) {
        const { to, amount } = EvmUtil.decodeErc20Transfer(parsedTx.data);
        return { sender, recipient: to, amount };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validates that a transaction meets minimum requirements before broadcasting.
   * Throws BadRequestException if validation fails.
   */
  assertValidEvmTransaction(
    hex: string,
    expectedRecipient: string,
    expectedAmount: BigNumber,
    asset: Asset,
  ): void {
    const result = this.validateEvmTransaction(hex, expectedRecipient, expectedAmount, asset);

    if (!result.isValid) {
      throw new BadRequestException(result.error || 'Invalid transaction');
    }
  }
}
