import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { isAsset, isFiat } from 'src/shared/models/active';
import { Util } from 'src/shared/utils/util';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { BankAdapter } from '../adapters/balances/bank.adapter';
import { BlockchainAdapter } from '../adapters/balances/blockchain.adapter';
import { CustomAdapter } from '../adapters/balances/custom.adapter';
import { ExchangeAdapter } from '../adapters/balances/exchange.adapter';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegration } from '../interfaces';

enum AdapterType {
  BLOCKCHAIN = 'Blockchain',
  EXCHANGE = 'Exchange',
  BANK = 'Bank',
  CUSTOM = 'Custom',
}

@Injectable()
export class LiquidityBalanceIntegrationFactory {
  private readonly adapters = new Map<AdapterType, LiquidityBalanceIntegration>();

  constructor(
    readonly blockchainAdapter: BlockchainAdapter,
    readonly exchangeAdapter: ExchangeAdapter,
    readonly bankAdapter: BankAdapter,
    readonly customAdapter: CustomAdapter,
  ) {
    this.adapters.set(AdapterType.BLOCKCHAIN, blockchainAdapter);
    this.adapters.set(AdapterType.EXCHANGE, exchangeAdapter);
    this.adapters.set(AdapterType.BANK, bankAdapter);
    this.adapters.set(AdapterType.CUSTOM, customAdapter);
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
    if (rule.context === 'Custom') return AdapterType.CUSTOM;

    if (isAsset(rule.target)) {
      if (this.matchesContext(IbanBankName, rule) || this.matchesContext(CardBankName, rule)) return AdapterType.BANK;

      if (this.matchesContext(ExchangeName, rule)) return AdapterType.EXCHANGE;

      if (this.matchesContext(Blockchain, rule)) return AdapterType.BLOCKCHAIN;

      throw new Error(`No balance adapter for LM rule ${rule.id} with context ${rule.context} found`);
    }

    if (isFiat(rule.target)) {
      return AdapterType.BANK;
    }

    throw new Error('Could not find integration for liquidity balance check. Supported Asset or Fiat.');
  }

  private matchesContext(enumObj: object, rule: LiquidityManagementRule): boolean {
    return Object.values(enumObj).some((e) => e.toString() === rule.context.toString());
  }
}
