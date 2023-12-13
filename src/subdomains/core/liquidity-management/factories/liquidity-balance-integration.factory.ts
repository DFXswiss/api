import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { BankAdapter } from '../adapters/balances/bank.adapter';
import { BlockchainAdapter } from '../adapters/balances/blockchain.adapter';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegration } from '../interfaces';

enum AdapterType {
  BLOCKCHAIN = 'Blockchain',
  BANK = 'Bank',
}
@Injectable()
export class LiquidityBalanceIntegrationFactory {
  private readonly adapters = new Map<AdapterType, LiquidityBalanceIntegration>();

  constructor(readonly blockchainAdapter: BlockchainAdapter, readonly bankAdapter: BankAdapter) {
    this.adapters.set(AdapterType.BLOCKCHAIN, blockchainAdapter);
    this.adapters.set(AdapterType.BANK, bankAdapter);
  }

  getIntegration(rule: LiquidityManagementRule): LiquidityBalanceIntegration {
    return this.adapters.get(this.getAdapterType(rule));
  }

  getIntegrations(
    rules: LiquidityManagementRule[],
  ): { integration: LiquidityBalanceIntegration; rules: LiquidityManagementRule[] }[] {
    const adapterMap = Util.groupByAccessor(rules, (r) => this.getAdapterType(r));
    return Array.from(adapterMap.entries()).map(([type, rules]) => ({ integration: this.adapters.get(type), rules }));
  }

  private getAdapterType(rule: LiquidityManagementRule): AdapterType {
    if (rule.target instanceof Asset) {
      return AdapterType.BLOCKCHAIN;
    }

    if (rule.target instanceof Fiat) {
      return AdapterType.BANK;
    }

    throw new Error('Could not find integration for liquidity balance check. Supported Asset or Fiat.');
  }
}
