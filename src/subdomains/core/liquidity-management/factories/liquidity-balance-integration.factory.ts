import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { isAsset, isFiat } from 'src/shared/models/active';
import { Util } from 'src/shared/utils/util';
import { BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankAdapter } from '../adapters/balances/bank.adapter';
import { BlockchainAdapter } from '../adapters/balances/blockchain.adapter';
import { ExchangeAdapter } from '../adapters/balances/exchange.adapter';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegration } from '../interfaces';

enum AdapterType {
  BLOCKCHAIN = 'Blockchain',
  EXCHANGE = 'Exchange',
  BANK = 'Bank',
}

@Injectable()
export class LiquidityBalanceIntegrationFactory {
  private readonly adapters = new Map<AdapterType, LiquidityBalanceIntegration>();

  constructor(
    readonly blockchainAdapter: BlockchainAdapter,
    readonly exchangeAdapter: ExchangeAdapter,
    readonly bankAdapter: BankAdapter,
  ) {
    this.adapters.set(AdapterType.BLOCKCHAIN, blockchainAdapter);
    this.adapters.set(AdapterType.EXCHANGE, exchangeAdapter);
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
    if (isAsset(rule.target)) {
      const blockchain = Object.values(Blockchain).find((b) => b.toString() === rule.context.toString());
      if (blockchain) return AdapterType.BLOCKCHAIN;

      const bank = Object.values(BankName).find((b) => b.toString() === rule.context.toString());
      if (bank) return AdapterType.BANK;

      return AdapterType.EXCHANGE;
    }

    if (isFiat(rule.target)) {
      return AdapterType.BANK;
    }

    throw new Error('Could not find integration for liquidity balance check. Supported Asset or Fiat.');
  }
}
