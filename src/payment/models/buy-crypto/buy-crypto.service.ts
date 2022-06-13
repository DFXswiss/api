import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { Between, In, IsNull } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { BuyRepository } from '../buy/buy.repository';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';
import { AmlCheck, BuyCrypto } from './buy-crypto.entity';
import { BuyCryptoRepository } from './buy-crypto.repository';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';
import { Buy } from '../buy/buy.entity';
import { Interval } from '@nestjs/schedule';
import { ExchangeUtilityService } from '../exchange/exchange-utility.service';
import { Price } from '../exchange/dto/price.dto';
import { NodeClient } from 'src/ain/node/node-client';

@Injectable()
export class BuyCryptoService {
  private readonly lock = new Lock(1800);
  private readonly client: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly exchangeUtilityService: ExchangeUtilityService,
  ) {}

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
    // lock might be needed?
    // multi-step process.
    // Step 1 -> calculateOutputAmounts
    // fetch all transactions from repo that doesn't have txId OR outputReferenceAsset?
    // fetch the buy entity
    // get the Asset -> name, type -> this is outputAsset
    // loop through every transaction
    // map outputReferenceAsset by required outputAsset
    // find matching price from ExchangeUtilityService
    // calculate outputReferenceAmount on Entity and set all connected properties! -> unit test.
    // calculate outputAmount on Entity and set all connected properties! -> unit test.
    // where to get txId and when is it set? there is no new chain TX yet, no history... separate step in between? look through history in OUT node???? REF Node?
    // Or will this be actually an outputTxId from OUT to wallet?
    // Step 2 -> send emails
    // get transaction history (by what? whats the mapper?)
    // fetch all transactions from repo that doesn't have mailSendDate and DOES have txId I guess
    // take email from buy -> user -> mail (it is commented as 'TO REMOVE', why?)
    // send emails

    // Step 1 - Define outputReferenceAsset and outputAsset pair, create transactions batches for every unique pair
    // fetch transactions that doesn't have outputReferenceAsset, outputAsset and batchId
    // get outputAsset from Buy, set outputReferenceAsset based on outputAsset
    // get EUR/BTC/USDC/USDT prices from kraken/binance and define outputReferenceAmount
    // save transactions with outputReferenceAsset, outputReferenceAmount and outputAsset
    // create new batches objects, save in the repository (this should ACID save batchId to transactions as well)
    // previous run fail recovery - fetch all transactions that have outputReferenceAsset and outputAsset, but does not have batchId
    // previous run fail recovery - make sure that these transactions doesn't exist in any batches
    // previous run fail recovery - recreate batches for such transactions
    // now we have transactions and batches saved in the initial state - only with outputReferenceAmount

    // Step 2 - Check liquidity on DEX node, reserve liquidity and define output prices in transactions
    // fetch all batches that are not "complete" and not "secured"
    // fetch all batches that are not "complete" but secured
    // for every not secured batch - check if liquidity (BTC, USDC or USDT) is enough (demand from this batch + secured and not complete in other batches)
    // if not - purchase liquidity for DFI (check for DFI availability is not required)
    // add output amount to the batch, add exchange price to the batch
    // save batch with flag "secured"
    // distribute outputAmount between transactions proportionally
    // save transactions with outputAmount
    // previous run failure recovery - what if batch is saved as "secured", but some transactions failed to save outputAmount (DB connection)???
    // previous run failure recovery - fetch all transactions that does have batchId, doesn't have outputAmount, and batch is "secured"
    // previous run failure recovery - calculate outputAmount again and save those transactions

    // Step 3 - Perform transfer from DEX node to OUT node
    // fetch all the batches that are "secured", but not "transferred" and "complete"
    // perform transfer from DEX to OUT for every batch

    // Step 4 - Perform transfer from OUT to User wallets
    // fetch all batches that are "secured", "transferred", but not "complete"
    // fetch transactions for every batch, that does not have outTxId
    // check if this is a new user, if it is - send a little utxo.
    // perform transfer from OUT to user wallet
    // save outTxId - fault tolerance... in worst case tx is stuck at OUT Node
    // in case all transactions from the batch have outTxId, mark batch as "complete", save batch

    // Step 5 Send confirmation emails.
    // fetch all batches that are "complete", but not "notified"
    // for every transaction make sure again that outTxId exists, if yes - send email
    // update transaction with recipientMail and mailSendDate.

    // Process complete!

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
     * * * Check if source liquidity is enough (Open point)
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
     * * Fetch all batches that are "complete", but not "notified"
     * * For every transaction make sure again that outTxId exists, if yes - send email
     * * Update transaction with recipientMail and mailSendDate.
     *
     * Process Complete!
     */

    // at every step when we write to BC, we need to check the history and confirm later in parallel. Especially for user payout!!!
    // maybe make a Step 2 parallel, cause you need to wait for swap, why not to parallel it???
    // !!!! at step 1 or step 3 - ignore batches for pair that is in the progress right now. Performance penalty???
    // get history from blockchain before sending from OUT to wallets to make sure TX complete ("transferred" is not enough cause its recorded )
    // don't forget about utxo...
    // what if any blockchain TX fails.
    // limit batch max volume
    // try to squeeze in one column the status, if its possible.
    // DFI liquidity in token on DEX.
    // notify if batch is stuck (cannot complete for long time)
    // notify in case of slippage and batch is stuck, or fallback

    // how to we get BTC/DFI rate in case tx will be performed by GS? testpoolswap?
    if (!this.lock.acquire()) return;

    try {
      await this.calculateOutputAmounts();
      // might be separate intervals
      await this.assignTxId();
      // might be separate intervals
      await this.sendMails();
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
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
  private async calculateOutputAmounts() {
    const transactions = await this.buyCryptoRepo.find({
      where: { outputReferenceAsset: IsNull() },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

    for (const tx of transactions) {
      const outputAsset = tx.buy?.asset?.name;
      const { outputReferenceAsset } = tx.defineAssetExchangePair(outputAsset);

      const referenceAssetPrice = await this.exchangeUtilityService.getMatchingPrice('EUR', outputReferenceAsset);

      const { outputReferenceAmount } = tx.calculateOutputReferenceAmount(referenceAssetPrice);

      // TODO - define asset price
      // const outputAssetPrice = this.client.get...;
      const outputAssetPrice = new Price();

      const update = tx.calculateOutputAmount(outputAssetPrice);

      this.buyCryptoRepo.save({ ...update, ...tx });
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
