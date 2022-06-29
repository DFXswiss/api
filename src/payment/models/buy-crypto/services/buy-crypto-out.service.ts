import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { Not, IsNull, In } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { Util } from 'src/shared/util';

@Injectable()
export class BuyCryptoOutService {
  private outClient: NodeClient;
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly whaleService: WhaleService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async getAssetsOnOutNode(): Promise<{ amount: number; asset: string }[]> {
    const utxo = await this.outClient.getBalance();
    const tokens = await this.outClient.getToken();

    const utxoBalance = { amount: +utxo, asset: 'DFI' };
    const tokensBalance = tokens.map((t) => this.outClient.parseAmount(t.amount));

    const assets = [...tokensBalance, utxoBalance];

    return assets;
  }

  async payoutTransactions(): Promise<void> {
    try {
      const batches = await this.buyCryptoBatchRepo.find({
        where: {
          status: In([BuyCryptoBatchStatus.SECURED, BuyCryptoBatchStatus.PAYING_OUT]),
          outTxId: Not(IsNull()),
        },
        relations: ['transactions', 'transactions.buy', 'transactions.buy.user'],
      });

      if (batches.length === 0) {
        return;
      }

      const outAssets = await this.getAssetsOnOutNode();

      for (const batch of batches) {
        try {
          await this.buyCryptoChainUtil.checkCompletion(batch, this.outClient);
        } catch (e) {
          console.error(`Error on checking pervious payout for a batch ID: ${batch.id}`, e);
          continue;
        }

        if (!(batch.status === BuyCryptoBatchStatus.SECURED || batch.status === BuyCryptoBatchStatus.PAYING_OUT)) {
          continue;
        }

        const canProceed = await this.checkNewPayouts(batch, outAssets);

        if (!canProceed) {
          continue;
        }

        const groups = batch.groupPayoutTransactions();

        batch.payingOut();
        this.buyCryptoBatchRepo.save(batch);

        for (const group of groups) {
          try {
            if (group.length === 0) {
              continue;
            }

            console.info(`Paying out ${group.length} transaction(s). Transaction ID(s): ${group.map((t) => t.id)}`);

            batch.outputAsset === 'DFI' ? await this.sendDFI(group) : await this.sendToken(group, batch.outputAsset);
          } catch (e) {
            console.error(
              `Failed to payout group of ${group.length} transaction(s). Transaction ID(s): ${group.map((t) => t.id)}`,
            );
            // continue with next group in case payout failed
            continue;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  private async checkNewPayouts(
    batch: BuyCryptoBatch,
    outAssets: { amount: number; asset: string }[],
  ): Promise<boolean> {
    const amountOnOutNode = outAssets.find((a) => a.asset === batch.outputAsset);

    if (!amountOnOutNode) {
      return false;
    }

    const balancePaid = Util.sumObj<BuyCrypto>(
      batch.transactions.filter((tx) => tx.isComplete),
      'outputAmount',
    );
    const balanceDifference = Util.round(amountOnOutNode.amount + balancePaid - batch.outputAmount, 8);
    const isMismatch = batch.outputAsset === 'DFI' ? balanceDifference > 1 : balanceDifference !== 0;

    if (isMismatch) {
      this.handleBalanceMismatch(batch, balanceDifference);
      return false;
    }

    return true;
  }

  private async sendToken(transactions: BuyCrypto[], outputAsset: string): Promise<void> {
    let txId: string;

    try {
      for (const tx of transactions) {
        await this.checkUtxo(tx.buy.user.address);
      }
      const payout = this.aggregatePayout(transactions);

      txId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, outputAsset, payout);
    } catch (e) {
      console.error(`Error on sending ${outputAsset} for output. Transaction IDs: ${transactions.map((t) => t.id)}`, e);
    }

    for (const tx of transactions) {
      try {
        const paidTransaction = tx.recordTransactionPayout(txId);
        await this.buyCryptoRepo.save(paidTransaction);
      } catch (e) {
        const errorMessage = `Error on saving payout txId to the database. Transaction ID: ${tx.id}. Payout ID: ${txId}`;

        console.error(errorMessage, e);
        this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }

  private async sendDFI(transactions: BuyCrypto[]): Promise<void> {
    let txId: string;

    try {
      const payout = this.aggregatePayout(transactions);

      txId = await this.outClient.sendUtxoToMany(payout);
    } catch (e) {
      console.error(`Error on sending DFI for output. Transaction IDs: ${transactions.map((t) => t.id)}`, e);
    }

    for (const tx of transactions) {
      try {
        const paidTransaction = tx.recordTransactionPayout(txId);
        await this.buyCryptoRepo.save(paidTransaction);
      } catch (e) {
        const errorMessage = `Error on saving payout txId to the database. Transaction ID: ${tx.id}. Payout ID: ${txId}`;

        console.error(errorMessage, e);
        this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!utxo) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }

  private handleBalanceMismatch(batch: BuyCryptoBatch, mismatchAmount: number) {
    const errorMessage = `Mismatch between batch and OUT amounts: ${
      mismatchAmount + ''
    }, cannot proceed with the batch ID: ${batch.id}`;

    console.error(errorMessage);
    this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);
  }

  private aggregatePayout(transactions: BuyCrypto[]): { addressTo: string; amount: number }[] {
    // sum up duplicated addresses, fallback in case transactions to same address and asset end up in one batch
    const uniqueAddresses = new Map<string, number>();

    transactions.forEach((t) => {
      const existingAmount = uniqueAddresses.get(t.buy.user.address);
      const increment = existingAmount ? Util.round(existingAmount + t.outputAmount, 8) : t.outputAmount;

      uniqueAddresses.set(t.buy.user.address, increment);
    });

    return [...uniqueAddresses.entries()].map(([addressTo, amount]) => ({ addressTo, amount }));
  }
}
