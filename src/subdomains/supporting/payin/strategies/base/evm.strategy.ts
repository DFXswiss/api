import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DepositRouteRepository } from 'src/mix/models/route/deposit-route.repository';
import { getCustomRepository } from 'typeorm';
import { PayInFactory } from '../../factories/payin.factory';
import { PayInEntry } from '../../interfaces';
import { PayInRepository } from '../../repositories/payin.repository';
import { PayInEvmService } from '../../services/payin-evm.service';
import { PayInStrategy } from './payin.strategy';

export abstract class EvmStrategy extends PayInStrategy {
  constructor(
    protected readonly blockchain: Blockchain,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super();
  }

  // TODO - implement prioritization if needed, check with Matthias if loop is not

  protected async processNewPayInEntries(): Promise<void> {
    const addresses: string[] = await this.getPayInAddresses();
    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    await this.getTransactionsAndCreatePayIns(addresses, lastCheckedBlockHeight);
  }

  //*** HELPER METHODS ***//

  private async getPayInAddresses(): Promise<string[]> {
    const routes = await getCustomRepository(DepositRouteRepository).find({
      deposit: { blockchain: this.blockchain },
    });

    return routes.map((dr) => dr.deposit.address);
  }

  private async getLastCheckedBlockHeight(): Promise<number> {
    return this.payInRepository
      .findOne({ where: { address: { blockchain: this.blockchain } }, order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getTransactionsAndCreatePayIns(addresses: string[], blockHeight: number): Promise<void> {
    for (const address of addresses) {
      const transactions = await this.payInEvmService.getTransactions(address, blockHeight);

      await this.verifyLastBlockTransactions(address, transactions, blockHeight);
      await this.processNewTransactions(transactions, blockHeight);
    }
  }

  private async verifyLastBlockTransactions(address: string, allTransactions: PayInEntry[], blockHeight: number) {
    const transactionsFromLastRecordedBlock = allTransactions.filter((t) => t.blockHeight === blockHeight);

    if (transactionsFromLastRecordedBlock.length === 0) return;

    await this.checkIfAllTransactionRecorder(address, transactionsFromLastRecordedBlock, blockHeight);
  }

  private async checkIfAllTransactionRecorder(
    address: string,
    transactions: PayInEntry[],
    blockHeight: number,
  ): Promise<void> {
    const recordedLastBlockPayIns = await this.payInRepository.find({
      address: { address, blockchain: this.blockchain },
      blockHeight,
    });

    for (const tx of transactions) {
      !recordedLastBlockPayIns.find((p) => p.txId === tx.txId) && (await this.createPayIn(tx));
    }
  }

  private async processNewTransactions(allTransactions: PayInEntry[], blockHeight: number) {
    const newTransactions = allTransactions.filter((t) => t.blockHeight > blockHeight);

    for (const tx of newTransactions) {
      await this.createPayIn(tx);
    }
  }

  private async createPayIn(transaction: PayInEntry): Promise<void> {
    const payIn = this.payInFactory.createFromTransaction(transaction);
    await this.payInRepository.save(payIn);
  }
}
