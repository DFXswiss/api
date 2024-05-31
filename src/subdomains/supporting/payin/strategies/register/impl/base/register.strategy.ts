import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
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

  abstract doAmlCheck(payIn: CryptoInput, route: Staking | Sell | Swap): Promise<CheckStatus> | CheckStatus;

  protected async createPayInsAndSave(transactions: PayInEntry[], log: PayInInputLog): Promise<void> {
    await this.payInService.createPayIns(transactions);

    log.newRecords.push(...transactions.map((p) => ({ address: p.address.address, txId: p.txId })));
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
