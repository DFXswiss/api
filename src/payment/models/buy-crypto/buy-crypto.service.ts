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
import { NodeClient } from 'src/ain/node/node-client';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from './entities/buy-crypto-batch.entity';
import { BuyCryptoBatchRepository } from './buy-crypto-batch.repository';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { MailService } from 'src/shared/services/mail.service';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Price } from '../exchange/dto/price.dto';

@Injectable()
export class BuyCryptoService {
  private readonly lock = new Lock(1800);
  private readonly dexClient: NodeClient;
  private readonly outClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
    private readonly mailService: MailService,
    readonly nodeService: NodeService,
  ) {
    this.dexClient = nodeService.getClient(NodeType.DEX, NodeMode.ACTIVE);
    this.outClient = nodeService.getClient(NodeType.OUTPUT, NodeMode.ACTIVE);
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

    // add on/off button -> settings service, in case it fails!
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

    // how to we get BTC/DFI rate in case tx will be performed by GS? testpoolswap?
    if (!this.lock.acquire()) return;

    try {
      await this.batchTransactionsByAssets();
      await this.secureLiquidity();
      await this.transferLiquidityForOutput();
      await this.payoutTransactions();
      await this.sentNotificationMails();
    } catch (e) {
      console.error('Exception during buy crypto process:', e);
    } finally {
      this.lock.release();
    }
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

  // *** Step 0 - Get recent write transactions from blockchain *** //

  private async getRecentChainHistory(): Promise<string[]> {
    const { blocks: currentHeight } = await this.dexClient.getInfo();
    const lastHeight = await this.buyCryptoRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((tx) => tx?.blockHeight ?? 0);

    return await this.dexClient
      .getHistories([Config.node.dexWalletAddress, Config.node.outWalletAddress], lastHeight, currentHeight)
      .then((h) => h.map((t) => t.txid));
  }

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

    const txWithAssets = await this.defineAssetPair(txInput);
    const referencePrices = await this.getReferencePrices(txWithAssets);
    const txWithReferenceAmount = await this.defineReferenceAmount(txWithAssets, referencePrices);
    const txWithBatches = await this.batchTransactions(txWithReferenceAmount);

    for (const tx of txWithBatches) {
      await this.buyCryptoRepo.save(tx);
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

  private async batchTransactions(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    const batches = new Map<string, BuyCryptoBatch>();

    for (const tx of transactions) {
      const { outputReferenceAmount, outputReferenceAsset, outputAsset } = tx;
      let batch = batches.get(outputReferenceAsset + '&' + outputAsset);

      if (!batch) {
        batch = this.buyCryptoBatchRepo.create({ outputReferenceAsset, outputAsset });
        batches.set(outputReferenceAsset + '&' + outputAsset, batch);
      }

      batch.addOutputReferenceAmount(outputReferenceAmount);

      tx.batch = batch;
    }

    return transactions;
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
      const { confirmations, blockhash } = await this.dexClient.getTx(batch.purchaseTxId);

      if (blockhash && confirmations > 0) {
        batch.secure();
        await this.calculateOutputAmounts(batch);
      }
    }
  }

  private async processNewBatches(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    for (const batch of newBatches) {
      const isSufficient = this.checkLiquidity(batch, securedBatches, pendingBatches);

      if (!isSufficient) {
        await this.purchaseLiquidity(batch);

        return;
      }

      batch.secure();
      await this.buyCryptoBatchRepo.save(batch);

      // some kind of recovery for batch save??
      await this.calculateOutputAmounts(batch);
    }
  }

  private async checkLiquidity(
    batch: BuyCryptoBatch,
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<boolean> {
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

      return availableAmount >= requiredAmount;
    } catch {
      // not sure if I should just return false on fail
      // cause this will purchase liquidity, not what I want
      return false;
    }
  }

  private async getAvailableTokenAmount(batch: BuyCryptoBatch): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === batch.outputAsset);

    return token ? token.amount : 0;
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    const DFIAmount =
      (await this.dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', 1)) * batch.outputReferenceAmount;

    try {
      const txId = await this.dexClient.compositeSwap(
        Config.node.dexWalletAddress,
        'DFI',
        Config.node.dexWalletAddress,
        batch.outputAsset,
        DFIAmount,
      );

      batch.pending(txId);
      await this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      // then what?
    }
  }

  private async calculateOutputAmounts(batch: BuyCryptoBatch): Promise<void> {
    for (const tx of batch.transactions) {
      tx.calculateOutputAmount(batch.outputReferenceAmount, batch.outputAmount);
      // try not to await, check if that will kill the DB
      await this.buyCryptoRepo.save(tx);
    }
  }

  // *** Process Buy Crypto - Step 3 *** //

  private async transferLiquidityForOutput(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

    for (const batch of batches) {
      batch.outputAsset === 'DFI' ? this.transferUtxoForOutput(batch) : this.transferTokenForOutput(batch);
    }
  }

  private async transferUtxoForOutput(batch: BuyCryptoBatch): Promise<void> {
    const txId = await this.dexClient.sendUtxo(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      batch.outputAmount,
    );

    batch.recordOutToDexTransfer(txId);
    this.buyCryptoBatchRepo.save(batch);
  }

  private async transferTokenForOutput(batch: BuyCryptoBatch): Promise<void> {
    const txId = await this.dexClient.sendToken(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      batch.outputAsset,
      batch.outputAmount,
    );

    batch.recordOutToDexTransfer(txId);
    this.buyCryptoBatchRepo.save(batch);
  }

  // *** Process Buy Crypto - Step 4 *** //

  private async payoutTransactions(): Promise<void> {
    const txInChain = await this.getRecentChainHistory();
    const batches = await this.buyCryptoBatchRepo.find({
      where: {
        status: BuyCryptoBatchStatus.SECURED,
        outTxId: Not(IsNull()),
      },
      relations: ['transactions'],
    });

    for (const batch of batches) {
      this.checkPreviousPayouts(batch, txInChain);

      if (batch.status === BuyCryptoBatchStatus.COMPLETE) {
        return;
      }

      for (const tx of batch.transactions) {
        // if DFI - then BEWARE you need to send utxo and NOT token
        // you actually can send all transactions in batch with sendTokenBatch (create sendMany style method for both token and utxo)
        if (tx.txId || txInChain.includes(tx.txId)) {
          // beware not to send second time
          return;
        }

        tx.outputAsset === 'DFI' ? await this.sendUtxo(tx) : await this.sendToken(tx);
      }
    }
  }

  private async checkPreviousPayouts(batch: BuyCryptoBatch, txInChain: string[]): Promise<void> {
    const isComplete = batch.transactions.every(({ txId }) => txId && txInChain.includes(txId));

    if (isComplete) {
      batch.complete();
      await this.buyCryptoBatchRepo.save(batch);
    }
  }

  private async sendUtxo(input: BuyCrypto): Promise<void> {
    const txId = this.outClient.sendUtxo(
      Config.node.outWalletAddress,
      input.buy.user.wallet.address,
      input.outputAmount,
    );

    await this.buyCryptoRepo.update({ id: input.id }, { txId });
  }

  private async sendToken(input: BuyCrypto): Promise<void> {
    await this.doTokenTx(input.buy.user.wallet.address, async (utxo) => {
      const txId = await this.outClient.sendToken(
        Config.node.outWalletAddress,
        input.buy.user.wallet.address,
        input.outputAsset,
        input.outputAmount,
        [utxo],
      );
      await this.buyCryptoRepo.update({ id: input.id }, { txId });

      return txId;
    });
  }

  // TODO - shared??
  private async doTokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>): Promise<void> {
    // you need to find out how to get utxo from User wallet
    const feeUtxo = await this.getFeeUtxo(addressFrom);
    feeUtxo ? await this.tokenTx(addressFrom, tx, feeUtxo) : this.tokenTx(addressFrom, tx); // no waiting;
  }

  // TODO - shared??
  private async tokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>, feeUtxo?: UTXO): Promise<void> {
    try {
      // get UTXO
      if (!feeUtxo) {
        const utxoTx = await this.sendFeeUtxo(addressFrom);
        await this.outClient.waitForTx(utxoTx);
        feeUtxo = await this.outClient
          .getUtxo()
          .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address === addressFrom));
      }

      // do TX
      await tx(feeUtxo);
    } catch (e) {
      console.error('Failed to do token TX:', e);
    }
  }

  // TODO - shared??
  private async getFeeUtxo(address: string): Promise<UTXO | undefined> {
    return await this.outClient
      .getUtxo()
      .then((utxos) =>
        utxos.find(
          (u) =>
            u.address === address &&
            u.amount.toNumber() < Config.node.minDfiDeposit &&
            u.amount.toNumber() > Config.node.minDfiDeposit / 4,
        ),
      );
  }

  // TODO - shared??
  private async sendFeeUtxo(address: string): Promise<string> {
    return await this.outClient.sendUtxo(Config.node.utxoSpenderAddress, address, Config.node.minDfiDeposit / 2);
  }

  // *** Process Buy Crypto - Step 5 *** //

  private async sentNotificationMails(): Promise<void> {
    const txOutput = await this.buyCryptoRepo.find({
      where: { recipientMail: IsNull(), mailSendDate: IsNull() },
      relations: ['bankTx', 'buy', 'buy.user', 'batch'],
    });

    for (const tx of txOutput) {
      if (tx.txId && tx.batch.status === BuyCryptoBatchStatus.COMPLETE) {
        await this.mailService.sendBuyCryptoMail(
          tx.buy.user.userData.mail,
          tx.buy.user.userData.language?.symbol.toLowerCase(),
          tx.txId,
          tx.outputAmount,
          tx.outputAsset,
        );

        tx.recipientMail = tx.buy.user.userData.mail;
        tx.mailSendDate = Date.now();

        // TODO - no need to await? make sure
        await this.buyCryptoRepo.save(tx);
      }
    }
  }

  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

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
