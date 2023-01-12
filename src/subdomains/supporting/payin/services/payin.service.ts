import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInFactory } from '../factories/payin.factory';
import { PayInEntry } from '../interfaces';
import { PayInRepository } from '../repositories/payin.repository';
import { PayIn, PayInPurpose, PayInStatus } from '../entities/payin.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class PayInService {
  constructor(
    private readonly payInRepository: PayInRepository,
    private readonly factory: PayInFactory,
    private readonly assetService: AssetService,
  ) {}

  //*** PUBLIC API ***//

  async getNewPayIns(): Promise<PayIn[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED });
  }

  async getNewPayInsForBlockchain(blockchain: Blockchain): Promise<PayIn[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED, address: { blockchain } });
  }

  async acknowledgePayIn(payIn: PayIn, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.acknowledge(purpose);

    await this.payInRepository.save(_payIn);
  }

  async failedPayIn(payIn: PayIn, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.fail(purpose);

    await this.payInRepository.save(_payIn);
  }

  async createNewPayIns(newTransactions: PayInEntry[]): Promise<PayIn[]> {
    const payIns = [];

    for (const tx of newTransactions) {
      try {
        // payIns.push(await this.createNewPayIn(tx));
      } catch {
        continue;
      }
    }

    return payIns;
  }

  // TODO - consider more reliable solution - in case of DB fail, some PayIns might be lost
  async persistPayIns(payIns: PayIn[]): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepository.save(payIn);
    }
  }

  //*** HELPER METHODS ***//

  // private async createNewPayIn(tx: PayInEntry): Promise<PayIn> {
  //   const assetEntity = await this.assetService.getAssetByQuery({
  //     dexName: tx.asset,
  //     blockchain: Blockchain.DEFICHAIN,
  //     type: tx.assetType,
  //   });

  //   if (!assetEntity) {
  //     const message = `Failed to process pay in. No asset ${tx.asset} found. PayInEntry:`;
  //     console.error(message, tx);

  //     throw new Error(message);
  //   }

  //   return this.factory.createFromTransaction(tx, assetEntity);
  // }
}
