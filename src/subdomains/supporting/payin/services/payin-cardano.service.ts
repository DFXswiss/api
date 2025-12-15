import { Injectable } from '@nestjs/common';
import { CardanoClient } from 'src/integration/blockchain/cardano/cardano-client';
import { CardanoTransactionDto } from 'src/integration/blockchain/cardano/dto/cardano.dto';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CryptoInput, PayInType } from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInCardanoService extends PayInBitcoinBasedService {
  private readonly client: CardanoClient;

  constructor(
    private readonly cardanoService: CardanoService,
    private readonly assetService: AssetService,
  ) {
    super();
    this.client = cardanoService.getDefaultClient();
  }

  getWalletAddress() {
    return this.cardanoService.getWalletAddress();
  }

  async checkHealthOrThrow(): Promise<void> {
    try {
      await this.cardanoService.getBlockHeight();
    } catch (error) {
      throw new Error('Cardano node is unhealthy');
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.cardanoService.getBlockHeight();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.cardanoService.getNativeCoinBalanceForAddress(address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.cardanoService.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.cardanoService.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.cardanoService.sendNativeCoinFromDex(addressTo, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.cardanoService.getCurrentGasCostForTokenTransaction(token);
  }

  async sendToken(account: WalletAccount, addressTo: string, token: Asset, amount: number): Promise<string> {
    return this.cardanoService.sendTokenFromAccount(account, addressTo, token, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.cardanoService.isTxComplete(txHash, minConfirmations);
  }

  async getTransactionHistory(startBlockHeight: number): Promise<CardanoTransactionDto[]> {
    const history = await this.client.getHistory(100);
    return history.filter((tx) => tx.blockNumber > startBlockHeight);
  }

  async getNewIncomingTransactions(address: string, startBlockHeight: number): Promise<CardanoTransactionDto[]> {
    const history = await this.client.getHistoryForAddress(address, 100);

    // Filter to only incoming transactions after startBlockHeight (where we are the recipient, not sender)
    return history.filter(
      (tx) =>
        tx.blockNumber > startBlockHeight &&
        tx.to?.toLowerCase() === address.toLowerCase() &&
        tx.from?.toLowerCase() !== address.toLowerCase(),
    );
  }

  async getNewPayInEntries(address: string, startBlockHeight: number): Promise<PayInEntry[]> {
    const transactions = await this.getNewIncomingTransactions(address, startBlockHeight);
    const asset = await this.assetService.getCardanoCoin();

    return transactions.map((tx) => ({
      senderAddresses: tx.from ?? null,
      receiverAddress: BlockchainAddress.create(tx.to, Blockchain.CARDANO),
      txId: tx.txId,
      txType: PayInType.DEPOSIT,
      blockHeight: tx.blockNumber,
      amount: tx.amount,
      asset,
    }));
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    const txId = await this.client.sendNativeCoinFromDex(payIn.destinationAddress.address, payIn.sendingAmount);
    const fee = await this.client.getTxActualFee(txId);
    return { outTxId: txId, feeAmount: fee };
  }
}
