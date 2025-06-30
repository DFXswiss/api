import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInEntry } from 'src/subdomains/supporting/payin/interfaces';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { RegisterStrategyRegistry } from './register.strategy-registry';

export interface PayInInputLog {
  newRecords: { address: string; txId: string }[];
}

export abstract class RegisterStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  @Inject() private readonly registry: RegisterStrategyRegistry;
  @Inject() protected readonly payInService: PayInService;
  @Inject() protected readonly payInRepository: PayInRepository;
  @Inject() protected readonly assetService: AssetService;

  onModuleInit() {
    this.registry.add(this.blockchain, this);
  }

  onModuleDestroy() {
    this.registry.remove(this.blockchain);
  }

  abstract get blockchain(): Blockchain;

  protected async createPayInsAndSave(transactions: PayInEntry[], log: PayInInputLog): Promise<void> {
    const payIns = await this.payInService.createPayIns(transactions);

    log.newRecords.push(...payIns.map((p) => ({ address: p.address.address, txId: p.inTxId })));
  }

  protected createNewLogObject(): PayInInputLog {
    return {
      newRecords: [],
    };
  }

  protected printInputLog(log: PayInInputLog, blockHeight: number | string, blockchain: Blockchain): void {
    if (log.newRecords.length > 0) {
      this.logger.verbose(
        `Created ${log.newRecords.length} new pay-in entry(ies) after block ${blockHeight} of blockchain ${blockchain}`,
      );
    }
  }
}
