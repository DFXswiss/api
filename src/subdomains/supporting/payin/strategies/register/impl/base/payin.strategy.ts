import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInEntry } from 'src/subdomains/supporting/payin/interfaces';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';

export interface PayInInputLog {
  recoveredRecords: { address: string; txId: string }[];
  newRecords: { address: string; txId: string }[];
}
export abstract class PayInStrategy {
  constructor(protected readonly payInFactory: PayInFactory, protected readonly payInRepository: PayInRepository) {}

  abstract checkPayInEntries(): Promise<void>;

  protected async createPayInAndSave(transaction: PayInEntry): Promise<void> {
    const payIn = this.payInFactory.createFromTransaction(transaction);
    await this.payInRepository.save(payIn);
  }

  protected createNewLogObject(): PayInInputLog {
    return {
      recoveredRecords: [],
      newRecords: [],
    };
  }

  protected printInputLog(log: PayInInputLog, blockHeight: number | string, blockchain: Blockchain): void {
    if (log.recoveredRecords.length > 0) {
      console.log(
        `Recovered ${log.recoveredRecords.length} pay-in entry(ies) from last block ${blockHeight} of blockchain ${blockchain}`,
        log.recoveredRecords,
      );
    }

    if (log.newRecords.length > 0) {
      console.log(
        `Created ${log.newRecords.length} new pay-in entry(ies) after block ${blockHeight} of blockchain ${blockchain}`,
        log.newRecords,
      );
    }
  }
}
