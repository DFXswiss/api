import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { DepositRouteRepository } from 'src/subdomains/supporting/address-pool/route/deposit-route.repository';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { getCustomRepository } from 'typeorm';
import { PayInFactory } from '../../../../factories/payin.factory';
import { PayInEntry } from '../../../../interfaces';
import { PayInRepository } from '../../../../repositories/payin.repository';
import { PayInEvmService } from '../../../../services/base/payin-evm.service';
import { PayInInputLog, RegisterStrategy } from './register.strategy';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { Config } from 'src/config/config';

export abstract class EvmStrategy extends RegisterStrategy {
  constructor(
    protected readonly blockchain: Blockchain,
    protected readonly nativeCoin: string,
    protected readonly dexService: DexService,
    protected readonly payInService: PayInService,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
    protected readonly assetService: AssetService,
  ) {
    super(dexService, payInFactory, payInRepository);
  }

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): AmlCheck {
    return route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS;
  }

  protected async processNewPayInEntries(): Promise<void> {
    const addresses: string[] = await this.getPayInAddresses();
    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    await this.getTransactionsAndCreatePayIns(addresses, lastCheckedBlockHeight);
  }

  //*** HELPER METHODS ***//

  private async getPayInAddresses(): Promise<string[]> {
    const routes = await getCustomRepository(DepositRouteRepository).find({
      where: { deposit: { blockchain: this.blockchain } },
      relations: ['deposit'],
    });

    return routes.map((dr) => dr.deposit.address);
  }

  private async getLastCheckedBlockHeight(): Promise<number> {
    return this.payInRepository
      .findOne({ where: { address: { blockchain: this.blockchain } }, order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getTransactionsAndCreatePayIns(addresses: string[], blockHeight: number): Promise<void> {
    const log = this.createNewLogObject();
    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    for (const address of addresses) {
      const [coinHistory, tokenHistory] = await this.payInEvmService.getHistory(address, blockHeight);

      const entries = this.mapHistoryToPayInEntries(address, coinHistory, tokenHistory, supportedAssets);

      if (entries.length === 0) return;

      const relevantEntries = this.filterOutDustEntries(entries);

      await this.verifyLastBlockEntries(address, relevantEntries, blockHeight, log);
      await this.processNewEntries(relevantEntries, blockHeight, log);
    }

    this.printInputLog(log, blockHeight, this.blockchain);
  }

  private mapHistoryToPayInEntries(
    address: string,
    coinHistory: EvmCoinHistoryEntry[],
    tokenHistory: EvmTokenHistoryEntry[],
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const relevantCoinEntries = this.filterEntriesByReceiverAddress(address, coinHistory);
    const relevantTokenEntries = this.filterEntriesByReceiverAddress(address, tokenHistory);

    return [
      ...this.mapCoinEntries(relevantCoinEntries, supportedAssets),
      ...this.mapTokenEntries(relevantTokenEntries, supportedAssets),
    ];
  }

  private filterEntriesByReceiverAddress<T extends EvmCoinHistoryEntry | EvmTokenHistoryEntry>(
    address: string,
    transactions: T[],
  ): T[] {
    return transactions.filter((tx) => tx.to.toLowerCase() === address.toLowerCase());
  }

  private mapCoinEntries(coinTransactions: EvmCoinHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return coinTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.convertToEthLikeDenomination(parseFloat(tx.value)),
      asset:
        this.assetService.getByQuerySync(supportedAssets, {
          dexName: this.nativeCoin,
          blockchain: this.blockchain,
          type: AssetType.COIN,
        }) ?? null,
    }));
  }

  private mapTokenEntries(tokenTransactions: EvmTokenHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return tokenTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.convertToEthLikeDenomination(parseFloat(tx.value), parseInt(tx.tokenDecimal)),
      asset:
        this.assetService.getByQuerySync(supportedAssets, {
          dexName: tx.tokenSymbol,
          blockchain: this.blockchain,
          type: AssetType.TOKEN,
        }) ?? null,
    }));
  }

  private filterOutDustEntries(entries: PayInEntry[]): PayInEntry[] {
    /**
     * @note
     * same check exists in CryptoInputInitSpecification it should always be there,
     * but it should be also used here to avoid unnecessary reference values calculation (better performance)
     */
    return entries.filter((e) => e.amount >= Config.blockchain.evm.coinMinimalRegisteredInput);
  }

  private async verifyLastBlockEntries(
    address: string,
    allTransactions: PayInEntry[],
    blockHeight: number,
    log: PayInInputLog,
  ) {
    const transactionsFromLastRecordedBlock = allTransactions.filter((t) => t.blockHeight === blockHeight);

    if (transactionsFromLastRecordedBlock.length === 0) return;

    await this.checkIfAllEntriesRecorded(address, transactionsFromLastRecordedBlock, blockHeight, log);
  }

  private async checkIfAllEntriesRecorded(
    address: string,
    entries: PayInEntry[],
    blockHeight: number,
    log: PayInInputLog,
  ): Promise<void> {
    const recordedLastBlockPayIns = await this.payInRepository.find({
      address: { address, blockchain: this.blockchain },
      blockHeight,
    });

    const lostEntries = entries.filter((e) => !recordedLastBlockPayIns.find((p) => p.inTxId === e.txId));

    if (lostEntries.length === 0) return;

    await this.addReferenceAmounts(lostEntries);

    console.log(
      `Recreating ${lostEntries.length} lost entries for ${this.blockchain} from block ${blockHeight}. TxId(s):`,
      lostEntries.map((e) => e.txId),
    );

    for (const tx of lostEntries) {
      try {
        await this.createPayInAndSave(tx);
        log.recoveredRecords.push({ address, txId: tx.txId });
      } catch (e) {
        console.log('Did not register pay-in: ', e);
        continue;
      }
    }
  }

  private async processNewEntries(allEntries: PayInEntry[], blockHeight: number, log: PayInInputLog) {
    const newEntries = allEntries.filter((t) => t.blockHeight > blockHeight);

    if (newEntries.length === 0) return;

    await this.addReferenceAmounts(newEntries);

    for (const entry of newEntries) {
      try {
        await this.createPayInAndSave(entry);
        log.newRecords.push({ address: entry.address.address, txId: entry.txId });
      } catch (e) {
        console.error('Did not register pay-in: ', e);
        continue;
      }
    }
  }
}
