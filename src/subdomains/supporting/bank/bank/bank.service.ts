import { Injectable, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { FiatPaymentMethod } from '../../payment/dto/payment-method.enum';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';
import { IbanBankName } from './dto/bank.dto';

export interface BankSelectorInput {
  amount: number;
  currency: string;
  paymentMethod: FiatPaymentMethod;
  userData: UserData;
  user?: User;
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

  async getIbansByName(bankName: IbanBankName): Promise<string[]> {
    return this.getBanksByName(bankName).then((banks) => banks.map((b) => b.iban));
  }

  async getBankInternal(name: IbanBankName, currency: string): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(`${name}-${currency}`, { name, currency });
  }

  async getBankById(id: number): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(`${id}`, { id });
  }

  async getBankByIban(iban: string): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(iban, { iban });
  }

  async getSenderBank(currency: string): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(currency, { currency, send: true });
  }

  // --- BANK SELECTOR --- //
  async getBank({ amount, currency, paymentMethod, userData, user }: BankSelectorInput): Promise<Bank> {
    const frickAmountLimit = 9000;
    const fallBackCurrency = 'EUR';

    const banks = await this.getAllBanks();

    // select the matching bank account
    let account: Bank;

    // VIP users get Yapeal (without receive check)
    if (user?.role === UserRole.VIP) {
      account = this.getVipBank(banks, IbanBankName.YAPEAL, currency);
    }

    if (!account && paymentMethod === FiatPaymentMethod.INSTANT) {
      // instant + bank tx => Revolut
      if (userData.hasBankTxVerification) {
        account = this.getMatchingBank(banks, IbanBankName.REVOLUT, currency, fallBackCurrency);
      }
      if (!account) {
        // instant => Olkypay / EUR
        account = this.getMatchingBank(banks, IbanBankName.OLKY, currency, fallBackCurrency);
      }
    }
    if (!account && (amount > frickAmountLimit || currency === 'USD')) {
      // amount > 9k => Frick || USD => Frick
      account = this.getMatchingBank(banks, IbanBankName.FRICK, currency, fallBackCurrency);
    }
    if (!account) {
      // default => MB
      account = this.getMatchingBank(banks, IbanBankName.MAERKI, currency, fallBackCurrency);
    }
    if (!account) {
      // fallback => any active bank
      account = this.getMatchingBank(banks, undefined, currency);
    }

    return account;
  }

  static isBankMatching(asset: Asset, accountIban: string): boolean {
    const bankName = this.blockchainToBankName(asset.blockchain);
    if (!bankName) return false;

    const expectedIban = this.ibanCache.get(`${bankName}-${asset.dexName}`);
    return expectedIban === accountIban;
  }

  // --- HELPER METHODS --- //
  private async loadIbanCache(): Promise<void> {
    const banks = await this.bankRepo.find();

    for (const bank of banks) {
      BankService.ibanCache.set(`${bank.name}-${bank.currency}`, bank.iban);
    }
  }

  private getMatchingBank(
    banks: Bank[],
    bankName: string | undefined,
    currencyName: string,
    fallBackCurrencyName?: string,
  ): Bank {
    return (
      banks.find((b) => (!bankName || b.name === bankName) && b.currency === currencyName && b.receive) ??
      banks.find((b) => (!bankName || b.name === bankName) && b.currency === fallBackCurrencyName && b.receive)
    );
  }

  private getVipBank(banks: Bank[], bankName: IbanBankName, currencyName: string): Bank | undefined {
    return banks.find((b) => b.name === bankName && b.currency === currencyName);
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
