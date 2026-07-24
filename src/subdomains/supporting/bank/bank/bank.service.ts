import { Injectable, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FiatPaymentMethod } from '../../payment/dto/payment-method.enum';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';
import { IbanBankName } from './dto/bank.dto';

export interface BankSelectorInput {
  amount?: number;
  currency: string;
  paymentMethod: FiatPaymentMethod;
  userData?: UserData;
}

@Injectable()
export class BankService implements OnModuleInit {
  private readonly logger = new DfxLogger(BankService);
  private static ibanCache: Map<string, string> = new Map(); // key: "bankName-currency", value: iban

  constructor(private bankRepo: BankRepository) {}

  onModuleInit() {
    void this.loadIbanCache();
  }

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.findCached(`all`);
  }

  async getBanksWithAsset(): Promise<Bank[]> {
    return this.bankRepo.find({ relations: { asset: true } });
  }

  async getBanksByName(bankName: IbanBankName): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(bankName, { name: bankName });
  }

  async getBankInternal(name: IbanBankName, currency: string): Promise<Bank> {
    // A (name, currency) pair can match more than one row (e.g. a retired legacy account alongside its
    // replacement, or a second account created for the same bank/currency without an asset link).
    // Rows are ordered newest-first; selectAttributionBank then prefers the asset-linked identity so
    // per-asset matching (isBankMatching) stays aligned with bank_tx history.
    const banks = await this.bankRepo.findCached(`${name}-${currency}`, {
      where: { name, currency },
      order: { id: 'DESC' },
      relations: { asset: true },
    });
    return BankService.selectAttributionBank(banks);
  }

  async getBankById(id: number): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(`${id}`, { id });
  }

  async getBankByIban(iban: string): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(iban, { iban });
  }

  async getReceiveBanks(): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(`receive`, { receive: true });
  }

  async getSenderBanks(currency: string): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(`send-${currency}`, { currency, send: true });
  }

  // --- BANK SELECTOR --- //
  async getBank({ currency, paymentMethod }: BankSelectorInput): Promise<Bank> {
    const fallBackCurrency = 'EUR';

    // Bank Frick's rows are receive=true so money arriving on its accounts is fully processed, but it
    // must never be offered to a customer as a deposit target - customers are always shown the incumbent
    // banks (Olkypay/Yapeal). It is deliberately filtered out of this customer-facing selector here;
    // inbound crediting runs via BankTxFrickService, not this path, and the outbound payout selector
    // applies its own separate Frick handling, so the exclusion affects only the deposit IBAN shown to
    // customers.
    const banks = (await this.getReceiveBanks()).filter((b) => b.name !== IbanBankName.FRICK);

    // select the matching bank account
    let account: Bank;

    // instant bank
    if (!account && paymentMethod === FiatPaymentMethod.INSTANT) {
      account = this.getMatchingBank(banks, currency, fallBackCurrency, (b) => b.sctInst);
    }

    // fallback => any active bank
    if (!account) {
      account = this.getMatchingBank(banks, currency, fallBackCurrency);
    }

    return account;
  }

  private getMatchingBank(
    banks: Bank[],
    currencyName: string,
    fallBackCurrencyName: string,
    selector?: (bank: Bank) => boolean,
  ): Bank {
    const matchingBanks = selector ? banks.filter(selector) : banks;

    return (
      matchingBanks.find((b) => b.currency === currencyName) ??
      matchingBanks.find((b) => b.currency === fallBackCurrencyName)
    );
  }

  static isBankMatching(asset: Asset, accountIban: string): boolean {
    const bankName = this.blockchainToBankName(asset.blockchain);
    if (!bankName) return false;

    const expectedIban = this.ibanCache.get(`${bankName}-${asset.dexName}`);
    return expectedIban === accountIban;
  }

  // --- HELPER METHODS --- //

  // Picks the bank row that owns attribution for a single (name, currency) key. `banks` must already
  // be sorted by id descending (newest first). Prefer a row linked to an asset: that binding is the
  // basis of every per-asset match (isBankMatching) and of the IBAN already present on booked
  // bank_tx. If a newer unbound row won instead, asset-side amounts would drop to 0 while the
  // exchange side still counted — permanent netting skew in the financial log. When no row is
  // asset-linked, fall back to the newest row so stale legacy rows still cannot silently win.
  private static selectAttributionBank(banks: Bank[]): Bank | undefined {
    if (!banks.length) return undefined;
    return banks.find((b) => b.asset != null) ?? banks[0];
  }

  private async loadIbanCache(): Promise<void> {
    // Newest-first so that within each (name, currency) group the order handed to
    // selectAttributionBank is deterministic; asset-linked rows still beat newer unbound ones.
    const banks = await this.bankRepo.find({ order: { id: 'DESC' }, relations: { asset: true } });

    const byKey = new Map<string, Bank[]>();
    for (const bank of banks) {
      const key = `${bank.name}-${bank.currency}`;
      const group = byKey.get(key);
      if (group) {
        group.push(bank);
      } else {
        byKey.set(key, [bank]);
      }
    }

    for (const [key, group] of byKey) {
      const selected = BankService.selectAttributionBank(group);
      if (!selected) continue;

      const distinctIbans = new Set(group.map((b) => b.iban));
      if (group.length > 1 && distinctIbans.size > 1) {
        this.logger.warn(
          `Multiple bank rows for key ${key} with different IBANs (count=${group.length}, ids=[${group
            .map((b) => b.id)
            .join(', ')}], selectedId=${selected.id})`,
        );
      }

      BankService.ibanCache.set(key, selected.iban);
    }
  }

  private static blockchainToBankName(blockchain: Blockchain): IbanBankName | undefined {
    switch (blockchain) {
      case Blockchain.MAERKI_BAUMANN:
        return IbanBankName.MAERKI;
      case Blockchain.OLKYPAY:
        return IbanBankName.OLKY;
      case Blockchain.YAPEAL:
        return IbanBankName.YAPEAL;
      case Blockchain.FRICK:
        return IbanBankName.FRICK;
      default:
        return undefined;
    }
  }
}
