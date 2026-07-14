import { Injectable, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
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
  private static ibanCache: Map<string, string> = new Map(); // key: "bankName-currency", value: iban

  constructor(private bankRepo: BankRepository) {}

  onModuleInit() {
    void this.loadIbanCache();
  }

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.findCached(`all`);
  }

  async getBanksByName(bankName: IbanBankName): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(bankName, { name: bankName });
  }

  async getBankInternal(name: IbanBankName, currency: string): Promise<Bank> {
    // A (name, currency) pair can match more than one row (e.g. a retired legacy Bank Frick account
    // alongside its replacement). Ordering by id descending deterministically prefers the newest row
    // instead of an arbitrary one, so a stale/legacy row can never silently win.
    return this.bankRepo.findOneCached(`${name}-${currency}`, { where: { name, currency }, order: { id: 'DESC' } });
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

    const banks = await this.getReceiveBanks();

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
  private async loadIbanCache(): Promise<void> {
    // Ordering by id descending makes the "first row per key wins" rule below deterministically prefer
    // the newest row for a given (name, currency), instead of relying on implicit DB row order.
    const banks = await this.bankRepo.find({ order: { id: 'DESC' } });

    for (const bank of banks) {
      const key = `${bank.name}-${bank.currency}`;
      if (!BankService.ibanCache.has(key)) {
        BankService.ibanCache.set(key, bank.iban);
      }
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
      default:
        return undefined;
    }
  }
}
