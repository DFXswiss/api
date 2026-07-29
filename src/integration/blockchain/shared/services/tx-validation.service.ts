import { Injectable } from '@nestjs/common';
import { BigNumber, ethers } from 'ethers';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { SolanaTransactionDto } from '../../solana/dto/solana.dto';
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
      return this.validateParsedTransaction(parsedTx, expectedRecipient, expectedAmount, expectedAsset);
    } catch (e) {
      return {
        isValid: false,
        error: e.message,
      };
    }
  }

  validateEvmTransactionResponse(
    tx: ethers.providers.TransactionResponse,
    expectedRecipient: string,
    expectedAmount: number,
    expectedAsset: Asset,
  ): TxValidationResult {
    try {
      return this.validateParsedTransaction(tx, expectedRecipient, expectedAmount, expectedAsset);
    } catch (e) {
      return {
        isValid: false,
        error: e.message,
      };
    }
  }

  private validateParsedTransaction(
    parsedTx: { from?: string; to?: string; value: BigNumber; data: string },
    expectedRecipient: string,
    expectedAmount: number,
    expectedAsset: Asset,
  ): TxValidationResult {
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
  }

  private parseNativeTransfer(parsedTx: { to?: string; value: BigNumber }): { recipient?: string; amount?: BigNumber } {
    const recipient = parsedTx.to?.toLowerCase();
    const amount = parsedTx.value;

    return { recipient, amount };
  }

  // Solana transfer verification: match at least one destination in the tx that pays the expected
  // owner + asset + amount. `SolanaTransactionDto.destinations[].to` carries the recipient's wallet
  // OWNER address for both native SOL and SPL transfers (SolanaClient.getTokenInstructions +
  // updateTokenInstruction resolve to `owner`, not the ATA), so the same owner-equality check
  // works for both. The mint disambiguates SPL from SOL and enforces the correct asset. Overpayment
  // is accepted (mirrors validateParsedTransaction); underpayment / wrong owner / wrong mint fails.
  // Fixes BUG-1260 (Solana anon payment completion accepted any finalized tx).
  validateSolanaTransaction(
    tx: SolanaTransactionDto,
    expectedOwner: string,
    expectedAmount: number,
    expectedAsset: Asset,
  ): TxValidationResult {
    try {
      const isCoin = expectedAsset.type === AssetType.COIN;
      const expectedMint = isCoin ? undefined : expectedAsset.chainId;

      if (!isCoin && !expectedMint) throw new Error('Asset has no chainId (mint address)');

      const match = tx.destinations.find((d) => {
        if (isCoin) return !d.tokenInfo && d.to === expectedOwner;
        return d.tokenInfo?.address === expectedMint && d.to === expectedOwner;
      });

      if (!match) throw new Error(`No transfer to ${expectedOwner} for ${expectedAsset.name} found`);
      if (match.amount < expectedAmount)
        throw new Error(`Insufficient amount: expected ${expectedAmount}, got ${match.amount}`);

      return { isValid: true, sender: tx.from?.[0] };
    } catch (e) {
      return { isValid: false, error: e.message };
    }
  }

  private parseErc20Transfer(
    parsedTx: { to?: string; data: string },
    asset: Asset,
  ): { recipient?: string; amount?: BigNumber } {
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
