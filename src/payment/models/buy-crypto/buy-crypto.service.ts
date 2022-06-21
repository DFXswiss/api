import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { Between, In, IsNull, Not } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { BuyRepository } from '../buy/buy.repository';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';
import { AmlCheck, BuyCrypto } from './entities/buy-crypto.entity';
import { BuyCryptoRepository } from './buy-crypto.repository';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';
import { Buy } from '../buy/buy.entity';
import { Interval } from '@nestjs/schedule';
import { ExchangeUtilityService } from '../exchange/exchange-utility.service';
import { NodeClient, NodeMode } from 'src/ain/node/node-client';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from './entities/buy-crypto-batch.entity';
import { BuyCryptoBatchRepository } from './buy-crypto-batch.repository';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { MailService } from 'src/shared/services/mail.service';
import { Price } from '../exchange/dto/price.dto';
import { WhaleService } from 'src/ain/whale/whale.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BlockchainWriteError } from 'src/payment/exceptions/blockchain-write.exception';
import { DBWriteError } from 'src/payment/exceptions/db-write.exception';

@Injectable()
export class BuyCryptoService {
  private readonly lock = new Lock(1800);
  private dexClient: NodeClient;
  private outClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly settingService: SettingService,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
    private readonly mailService: MailService,
    private readonly whaleService: WhaleService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
  }

  async create(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!entity.bankTx) throw new BadRequestException('Bank TX not found');

    // buy
    if (buyId) entity.buy = await this.getBuy(buyId);

    return await this.buyCryptoRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne(id, { relations: ['buy'] });
    if (!entity) throw new NotFoundException('Buy crypto not found');

    // const buyIdBefore = entity.buy?.id;
    // const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // buy
    if (dto.buyId) update.buy = await this.getBuy(dto.buyId);

    Util.removeNullFields(entity);

    entity = await this.buyCryptoRepo.save({ ...update, ...entity });

    // activate user
    if (entity.amlCheck === AmlCheck.PASS && entity.buy?.user?.status === UserStatus.NA) {
      await this.userService.updateUserInternal(entity.buy.user.id, { status: UserStatus.ACTIVE });
    }

    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    // await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  @Interval(300000)
  async processBuyCrypto() {
    /**
     * Step 1 - Define outputReferenceAsset and outputAsset pair, create transactions batches for every unique pair
     * * Fetch transactions that doesn't have outputReferenceAsset, outputAsset and batchId
     * * Access outputAsset from Buy, define outputReferenceAsset from outputAsset based on domain rule
     * * Get EUR to BTC/USDC/USDT prices from kraken/binance and define outputReferenceAmount
     * * Save transactions with outputReferenceAsset, outputReferenceAmount and outputAsset
     * * > Transactions failed to save will just go to the next batches
     * * Create new batches objects for every unique pair, save in the batches repository (ACID saves batchId to transactions as well, we are safe)
     * * > Fail recovery > fetch all transactions that have outputReferenceAsset and outputAsset, but does not have batchId (might be impossible case)
     * * > Fail recovery > make sure that these transactions doesn't exist in any batches
     * * > Fail recovery > recreate batches for such transactions
     * * - Now we have transactions and batches saved in the initial state - only with outputReferenceAmount
     *
     * Matthias - maybe first create a batch and then just push tx into batch (no need to save txId on batch) - good point! THen fail recovery might!! not be needed
     *
     * Step 2 - Check liquidity on DEX node, reserve liquidity and define output prices in transactions
     * * Fetch all batches that are not "complete" and not "secured"
     * * Fetch all batches that are not "complete" but "secured"
     * * For every not secured batch
     * * * Check if target liquidity (everything other than DFI or 1 to 1) is enough (demand from this batch + secured and not complete in other batches)
     * * If not - attempt to swap target asset liquidity for DFI (check for DFI availability is not required)
     * * Check for slippage, if more than 3% ->
     * * > Mark batch as "paused" and you get an email
     * * > OR define breaking transaction, break down batch on two, set original batch to "canceled"
     * * * > Process batch for healthy transactions
     * * * > Mark match with breaking transaction to "paused", send an email. (What to do is open point). Replay mechanism or manual processing.
     * * Add total output amount for all transactions to the batch, add exchange price to the batch.
     * * Save batch with flag "secured"
     * * Distribute outputAmount between transactions proportionally
     * * Save transactions with outputAmount
     * * > previous run failure recovery - what if batch is saved as "secured", but some transactions failed to save outputAmount (DB connection), then
     * * > previous run failure recovery - fetch all transactions that does have batchId, doesn't have outputAmount, and batch is "secured"
     * * > previous run failure recovery - calculate outputAmount again based on batch total amount and save those transactions
     *
     * Step 3 - Perform transfer from DEX node to OUT node
     * * Fetch all the batches that are "secured", but not "transferred" and "complete"
     * * Perform transfer from DEX to OUT for every batch - need to wait
     * * Save batch as "transferred"
     *
     * Step 4 - Perform transfer from OUT to User wallets
     * * Check if amount of batch is exactly matches the amount that you got from DEX to OUT
     * * Fetch all batches that are "secured", "transferred", but not "complete"
     * * Filter transactions for every batch, that does not have outTxId
     * * Check if this is a new user, if it is - send a little utxo, only if its not DFI
     * * Perform transfer from OUT to user wallet
     * * Save outTxId (fault tolerance... in worst case tx is stuck at OUT Node)
     * * In case all transactions from the batch have outTxId, mark batch as "complete", batch is saved
     * *
     * Step 5 (batch might not be needed, "notified")
     * * Fetch all batches that are "complete", but not "notified" // maybe notified is not needed
     * * For every transaction make sure again that outTxId exists, if yes - send email
     * * Update transaction with recipientMail and mailSendDate.
     *
     * Process Complete!
     */

    // Done - add on/off button -> settings service, in case it fails!
    // check the exact match of OUT node and payout values
    // don't forget about rounding issues
    // when doing token -> 10 max addresses at the same - batch again on send from OUT to wallets with max 10 addresses.
    // utxo - limit is a 100 addresses - also batch.
    // at every step when we write to BC, we need to check the history and confirm later in parallel. Especially for user payout!!!
    // maybe make a Step 2 parallel, cause you need to wait for swap, why not to parallel it???
    // make sure that amount that will be sent out from OUT node MATCH those that received from DEX node, OUt should be completely empty as a check
    // !!!! at step 1 or step 3 - ignore batches for pair that is in the progress right now. Performance penalty???
    // get history from blockchain before sending from OUT to wallets to make sure TX complete ("transferred" is not enough cause its recorded )
    // don't forget about utxo...
    // what if any blockchain TX fails.
    // limit batch max volume.
    // try to squeeze in one column the status, if its possible.
    // DFI liquidity in token on DEX.
    // notify if batch is stuck (cannot complete for long time)
    // notify in case of slippage and batch is stuck, or fallback
    // send utxo to user only if its not DFI (cause its already utxo) AND there is no utxo on user wallet -> check via Whale client.
    // check the the asset balance on OUT, check if there is some of the incoming batch, if yes - block.

    // how to we get BTC/DFI rate in case tx will be performed by GS? testpoolswap?
    if ((await this.settingService.get('buy-process')) !== 'on') return;
    if (!this.lock.acquire()) return;

    await this.handle(this.batchTransactionsByAssets);
    await this.handle(this.secureLiquidity);
    await this.handle(this.transferLiquidityForOutput);
    await this.handle(this.payoutTransactions);
    // we actually need to incorporate part of update here
    await this.handle(this.sentNotificationMails);

    this.lock.release();
  }

  async updateVolumes(): Promise<void> {
    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // const buyIds = await this.buyRepo.find().then((l) => l.map((b) => b.id));
    // await this.updateBuyVolume(buyIds);
  }

  async updateRefVolumes(): Promise<void> {
    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // const refs = await this.buyCryptoRepo
    //   .createQueryBuilder('buyCrypto')
    //   .select('usedRef')
    //   .groupBy('usedRef')
    //   .getRawMany<{ usedRef: string }>();
    // await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    // TODO aktivieren in history nach Umstellung cryptoBuy -> buyCrypto
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: In(userIds) } } },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  // --- HELPER METHODS --- //

  // *** Process Buy Crypto - Step 1 *** //

  private async batchTransactionsByAssets(): Promise<void> {
    const txInput = await this.buyCryptoRepo.find({
      where: {
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputReferenceAsset: IsNull(),
        outputReferenceAmount: IsNull(),
        outputAsset: IsNull(),
        batch: IsNull(),
      },
      relations: ['bankTx', 'buy', 'buy.user', 'batch'],
    });

    if (txInput.length === 0) {
      return;
    }

    // I could remove it after I do the wrapper.
    try {
      const txWithAssets = await this.defineAssetPair(txInput);
      const referencePrices = await this.getReferencePrices(txWithAssets);
      const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
      const blockedAssets = await this.getAssetsOnOutNode();
      const batches = await this.batchTransactions(txWithReferenceAmount, blockedAssets);

      for (const batch of batches) {
        // in case of interim DB failure - will safely start over
        await this.buyCryptoBatchRepo.save(batch);
      }
    } catch (e) {
      console.error('Error batching input transactions', e);
    }
  }

  private async getReferencePrices(txWithAssets: BuyCrypto[]): Promise<Map<string, Price>> {
    const result = new Map<string, Price>();
    const referenceAssets = [...new Set(txWithAssets.map((tx) => tx.outputReferenceAsset))];

    await Promise.all(
      referenceAssets.map(async (asset) => await this.exchangeUtilityService.getMatchingPrice('EUR', asset)),
    ).then((prices) => prices.forEach((price, i) => result.set(referenceAssets[i], price)));

    return result;
  }

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const outputAsset = tx.buy?.asset?.name;
      tx.defineAssetExchangePair(outputAsset);
    }

    return transactions;
  }

  private async defineReferenceAmount(
    transactions: BuyCrypto[],
    referencePrices: Map<string, Price>,
  ): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      const { outputReferenceAsset } = tx;

      const referenceAssetPrice = referencePrices.get(outputReferenceAsset);

      tx.calculateOutputReferenceAmount(referenceAssetPrice);
    }

    return transactions;
  }

  private async getAssetsOnOutNode(): Promise<{ amount: number; asset: string }[]> {
    const tokens = await this.outClient.getToken();

    return tokens.map((t) => this.outClient.parseAmount(t.amount));
  }

  private async batchTransactions(
    transactions: BuyCrypto[],
    blockedAssets: { amount: number; asset: string }[],
  ): Promise<BuyCryptoBatch[]> {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAsset, outputAsset } = tx;

      // not allowing to create a batch for an asset that still exists on OUT node
      if (blockedAssets.find((a) => a.asset === outputAsset)) {
        console.warn(`Halting with creation of a batch for asset: ${outputAsset}, balance still available on OUT node`);
        return;
      }

      let batch = batches.get(outputReferenceAsset + '&' + outputAsset);

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({ outputReferenceAsset, outputAsset });
        batches.set(outputReferenceAsset + '&' + outputAsset, batch);
      }

      batch.addTransaction(tx);
    }

    return [...batches.values()];
  }

  // *** Process Buy Crypto - Step 2 *** //

  private async secureLiquidity(): Promise<void> {
    const newBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.CREATED });
    const securedBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED });
    const pendingBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.PENDING_LIQUIDITY });

    await this.secureLiquidityPerBatch(newBatches, securedBatches, pendingBatches);
  }

  private async secureLiquidityPerBatch(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    await this.checkPendingBatches(pendingBatches);
    await this.processNewBatches(newBatches, securedBatches, pendingBatches);
  }

  private async checkPendingBatches(pendingBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of pendingBatches) {
      try {
        // get the output amount for purchase here -> getRecentChainHistory
        // for non-reference just take the amount
        const { blockhash, confirmations } = await this.dexClient.getTx(batch.purchaseTxId);

        if (blockhash && confirmations > 0) {
          const liquidity = await this.getLiquidityAfterPurchase(batch);
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);
        }
      } catch (e) {
        console.error(`Failed to check pending batch, ID: ${batch.id}`, e);
      }
    }
  }

  private async getLiquidityAfterPurchase(batch: BuyCryptoBatch): Promise<number> {
    const { purchaseTxId, outputAsset, outputReferenceAsset, outputReferenceAmount } = batch;

    if (outputReferenceAsset === outputAsset) {
      return outputReferenceAmount;
    }

    const history = await this.getRecentChainHistory();
    const transaction = history.find((tx) => tx.txId === purchaseTxId);

    const amounts = transaction.amounts.map((a) => this.dexClient.parseAmount(a));

    const { amount } = amounts.find((a) => a.asset === outputAsset);

    if (!amount) {
      // throw ???
    }

    return amount;
  }

  private async processNewBatches(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    for (const batch of newBatches) {
      try {
        const liquidity = await this.checkLiquidity(batch, securedBatches, pendingBatches);

        if (liquidity !== 0) {
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);

          return;
        }

        await this.purchaseLiquidity(batch);
      } catch (e) {
        this.handleError(e, 'processNewBatches');
      }
    }
  }

  private async checkLiquidity(
    batch: BuyCryptoBatch,
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<number> {
    const securedAmount = securedBatches
      .filter((securedBatch) => securedBatch.outputAsset === batch.outputAsset)
      .reduce((acc, curr) => acc + curr.outputReferenceAmount, 0);

    const pendingAmount = pendingBatches
      .filter((pendingBatch) => pendingBatch.outputAsset === batch.outputAsset)
      .reduce((acc, curr) => acc + curr.outputReferenceAmount, 0);

    try {
      const requiredAmount = await this.dexClient.testCompositeSwap(
        batch.outputReferenceAsset,
        batch.outputAsset,
        batch.outputReferenceAmount + securedAmount + pendingAmount,
      );

      const availableAmount = await this.getAvailableTokenAmount(batch);

      return availableAmount >= requiredAmount ? requiredAmount : 0;
    } catch (e) {
      // this should just abort the batch processing, no specific handler
      console.error(`Error on checking liquidity for a batch, ID: ${batch.id}`, e);
      throw e;
    }
  }

  private async getAvailableTokenAmount(batch: BuyCryptoBatch): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === batch.outputAsset);

    return token ? token.amount : 0;
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    try {
      const DFIAmount =
        (await this.dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', 1)) * batch.outputReferenceAmount;

      // make a swap for a bit bigger amount if this is reference asset
      const txId = await this.dexClient.compositeSwap(
        Config.node.dexWalletAddress,
        'DFI',
        Config.node.dexWalletAddress,
        batch.outputAsset,
        DFIAmount,
      );

      batch.pending(txId);
    } catch (e) {
      // we can live with it - remove
      throw new BlockchainWriteError('Purchase Liquidity', e);
    }

    try {
      await this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      throw new DBWriteError('Save Batch after liquidity purchase', e);
    }
  }

  // *** Process Buy Crypto - Step 3 *** //

  private async transferLiquidityForOutput(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

    for (const batch of batches) {
      try {
        batch.outputAsset === 'DFI'
          ? this.transferForOutput(batch, this.transferUtxo)
          : this.transferForOutput(batch, this.transferToken);
      } catch (e) {
        this.handleError(e, 'transferLiquidityForOutput');
      }
    }
  }

  private async transferForOutput(
    batch: BuyCryptoBatch,
    transfer: (batch: BuyCryptoBatch) => Promise<string>,
  ): Promise<void> {
    let txId: string;

    // read from out and write to DB as a recovery.
    // DO this check so not to process twice. or do it manually

    try {
      // no need a wrapper, just use sendToken
      txId = await transfer(batch);
    } catch (e) {
      // this also might be removed
      throw new BlockchainWriteError('Transfer from DEX to OUT', e);
    }

    try {
      batch.recordOutToDexTransfer(txId);
      this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      throw new DBWriteError('Saving txId to batch', e);
    }
  }

  // this will fail
  private async transferUtxo(batch: BuyCryptoBatch): Promise<string> {
    return await this.dexClient.sendUtxo(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      batch.outputAmount,
    );
  }

  // use only this method
  private async transferToken(batch: BuyCryptoBatch): Promise<string> {
    return await this.dexClient.sendToken(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      batch.outputAsset,
      batch.outputAmount,
    );
  }

  // *** Process Buy Crypto - Step 4 *** //

  private async payoutTransactions(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({
      where: {
        status: BuyCryptoBatchStatus.SECURED,
        outTxId: Not(IsNull()),
      },
      relations: ['transactions'],
    });

    const recentChainHistory = await this.getRecentChainHistory();
    const outAssets = await this.getAssetsOnOutNode();

    for (const batch of batches) {
      try {
        await this.checkPreviousPayouts(batch, recentChainHistory);
      } catch (e) {
        // log the error and continue with next batch
        console.error(`Error on checking pervious payout for a batch ID: ${batch.id}`, e);
      }

      if (batch.status === BuyCryptoBatchStatus.COMPLETE) {
        return;
      }

      const isValid = await this.validateNewPayouts(batch, outAssets);

      if (!isValid) {
        break;
      }

      const groups = this.groupPayoutTransactions(batch);

      for (const group of groups) {
        // maybe overkill
        const transactions = this.validateTransactions(group, recentChainHistory);

        try {
          batch.outputAsset === 'DFI'
            ? await this.sendDFI(transactions)
            : await this.sendToken(transactions, batch.outputAsset);
        } catch (e) {
          this.handleError(e, 'payoutTransactions');
        }
      }
    }
  }

  private async checkPreviousPayouts(
    batch: BuyCryptoBatch,
    recentChainHistory: { txId: string; blockHeight: number }[],
  ): Promise<void> {
    const isComplete = batch.transactions.every(({ txId }) => {
      const inChain = recentChainHistory.find((tx) => tx.txId === txId);
      return !!(txId && inChain);
    });

    if (isComplete) {
      // no write to blockchain, if write is failed, just start over
      batch.recordBlockHeight(recentChainHistory);
      batch.complete();

      await this.buyCryptoBatchRepo.save(batch);
    }
  }

  private async validateNewPayouts(
    batch: BuyCryptoBatch,
    outAssets: { amount: number; asset: string }[],
  ): Promise<boolean> {
    const amountOnOutNode = outAssets.find((a) => a.asset === batch.outputAsset);
    const isMatch = amountOnOutNode && amountOnOutNode.amount === batch.outputAmount;

    if (!isMatch && amountOnOutNode) {
      const mismatch = amountOnOutNode.amount - batch.outputAmount;
      console.error(`Mismatch between batch and OUT amounts: ${mismatch}, cannot proceed with the batch`);
    }

    return isMatch;
  }

  private groupPayoutTransactions(batch: BuyCryptoBatch): BuyCrypto[][] {
    const groupSize = batch.outputAsset === 'DFI' ? 100 : 10;
    const numberOfGroups = Math.ceil(batch.transactions.length / groupSize);
    const result: BuyCrypto[][] = [];

    for (let i = 0; i <= numberOfGroups; i += groupSize) {
      result.push(batch.transactions.slice(i, i + groupSize));
    }

    return result;
  }

  // maybe overkill
  private validateTransactions(
    group: BuyCrypto[],
    recentChainHistory: { txId: string; blockHeight: number }[],
  ): BuyCrypto[] {
    return group.filter((tx) => {
      const inChain = recentChainHistory.find((chainTx) => chainTx.txId === tx.txId);
      !(tx.txId || inChain);
    });
  }

  private async sendToken(transactions: BuyCrypto[], outputAsset: string): Promise<void> {
    for (const tx of transactions) {
      // need to wait for tx completion?
      await this.checkUtxo(tx.buy.user.wallet.address);
    }

    const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.wallet.address, amount: tx.outputAmount }));

    const txId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, outputAsset, payload);

    for (const tx of transactions) {
      // in case this break, see the OUT node, there is nowhere to get txId from
      await this.buyCryptoRepo.update({ id: tx.id }, { txId });
    }
  }

  private async sendDFI(transactions: BuyCrypto[]): Promise<void> {
    const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.wallet.address, amount: tx.outputAmount }));

    const txId = await this.outClient.sendDFIToMany(payload);

    for (const tx of transactions) {
      await this.buyCryptoRepo.update({ id: tx.id }, { txId });
    }
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!utxo) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }

  // *** Process Buy Crypto - Step 5 *** //

  private async sentNotificationMails(): Promise<void> {
    const txOutput = await this.buyCryptoRepo.find({
      where: {
        recipientMail: IsNull(),
        mailSendDate: IsNull(),
        txId: Not(IsNull()),
        batch: { status: BuyCryptoBatchStatus.COMPLETE },
      },
      relations: ['bankTx', 'buy', 'buy.user', 'batch'],
    });

    for (const tx of txOutput) {
      await this.mailService.sendTranslatedMail({
        userData: tx.buy.user.userData,
        translationKey: 'payment.buyCrypto',
        params: {
          buyFiatAmount: tx.amountInEur,
          // double check the asset
          buyFiatAsset: 'EUR',
          buyCryptoAmount: tx.outputAmount,
          buyCryptoAsset: tx.outputAsset,
          buyFeePercentage: tx.percentFee,
          // double check this field
          buyFeeAmount: tx.absoluteFeeAmount,
          buyWalletAddress: tx.buy.user.wallet.address,
          buyTxId: tx.txId,
        },
      });

      tx.confirmSentMail();

      // TODO - no need to await? make sure
      await this.buyCryptoRepo.save(tx);
    }
  }

  // *** Shared - Get recent write transactions from blockchain *** //

  private async getRecentChainHistory(): Promise<{ txId: string; blockHeight: number; amounts: string[] }[]> {
    const { blocks: currentHeight } = await this.dexClient.getInfo();
    // not sure about it, if its safe enough
    const lastHeight = await this.buyCryptoRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((tx) => tx?.blockHeight ?? 0);

    return await this.dexClient
      .getHistories([Config.node.dexWalletAddress, Config.node.outWalletAddress], lastHeight, currentHeight)
      .then((h) => h.map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts })));
  }

  private handleError(e: Error, context: string) {
    if (e instanceof BlockchainWriteError) {
      // log the fact that liquidity could not be purchased
      // react to the fact (event via monitoring or mail)
      return;
    }

    if (e instanceof DBWriteError) {
      // react to the fact that liquidity was purchased.
      // but batch was not saved
      // default to halt in memory when more than one error or
      return;
    }

    // else just log and abort the batch, cause thats a liquidityCheck failure
  }

  // makes sure to continue the flow if one step fails
  private async handle(action: () => Promise<void>): Promise<void> {
    try {
      return action();
    } catch {}
  }

  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

  // keep the methods
  private async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyCrypto.bankTx', 'bankTx')
        .where('buyCrypto.buyId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('bankTx.bookingDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  // keep the methods
  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume, credit } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur * refFactor)', 'volume')
        .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
        .where('usedRef = :ref', { ref })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number; credit: number }>();

      await this.userService.updateRefVolume(ref, volume ?? 0, credit ?? 0);
    }
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['buy'],
    });

    return buyCryptos.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.buy?.asset?.name,
    }));
  }

  // Monitoring

  async getIncompleteTransactions(): Promise<number> {
    return await this.buyCryptoRepo.count({ mailSendDate: IsNull() });
  }

  async getLastOutputDate(): Promise<Date> {
    return await this.buyCryptoRepo.findOne({ order: { outputDate: 'DESC' } }).then((b) => b.outputDate);
  }
}
