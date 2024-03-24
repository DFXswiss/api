import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { BankAccount } from 'src/subdomains/supporting/bank/bank-account/bank-account.entity';
import { CountryService } from '../../../../shared/models/country/country.service';
import { FiatPaymentMethod } from '../../payment/dto/payment-method.enum';
import { Bank, BankName } from './bank.entity';
import { BankRepository } from './bank.repository';

export interface BankSelectorInput {
  amount: number;
  currency: string;
  bankAccount?: BankAccount;
  paymentMethod: FiatPaymentMethod;
  userData: UserData;
}

@Injectable()
export class BankService {
  private readonly cache = new AsyncCache<Bank[]>(CacheItemResetPeriod.EVERY_5_MINUTE);

  constructor(private bankRepo: BankRepository, private countryService: CountryService) {}

  async getAllBanks(): Promise<Bank[]> {
    return this.cache.get(`all`, () => this.bankRepo.find());
  }

  async getInstantBanks(): Promise<Bank[]> {
    return this.cache.get(`instantBanks`, () => this.bankRepo.findBy({ sctInst: true }));
  }

  async getBankInternal(name: BankName, currency: string): Promise<Bank> {
    return this.cache.get(`${name}-${currency}`, () => this.bankRepo.findBy({ name, currency }))?.[0];
  }

  // --- BankSelector --- //
  async getBank({ bankAccount, amount, currency, paymentMethod, userData }: BankSelectorInput): Promise<Bank> {
    const frickAmountLimit = 9000;
    const fallBackCurrency = 'EUR';

    const ibanCodeCountry = bankAccount
      ? await this.countryService.getCountryWithSymbol(bankAccount.iban.substring(0, 2))
      : undefined;

    const banks = await this.bankRepo.find();

    // select the matching bank account
    let account: Bank;

    if (paymentMethod === FiatPaymentMethod.INSTANT) {
      // instant + bank tx => Revolut
      if (userData.hasBankTxVerification) {
        account = this.getMatchingBank(banks, BankName.REVOLUT, currency, fallBackCurrency);
      }
      if (!account) {
        // instant => Olkypay / EUR
        account = this.getMatchingBank(banks, BankName.OLKY, currency, fallBackCurrency);
      }
    }
    if (!account && (amount > frickAmountLimit || currency === 'USD')) {
      // amount > 9k => Frick || USD => Frick
      account = this.getMatchingBank(banks, BankName.FRICK, currency, fallBackCurrency);
    }
    if (!account && (!ibanCodeCountry || ibanCodeCountry.maerkiBaumannEnable)) {
      // Valid Maerki Baumann country => MB CHF/USD/EUR
      account = this.getMatchingBank(banks, BankName.MAERKI, currency, fallBackCurrency);
    }
    if (!account) {
      // Default => MB
      account = this.getMatchingBank(banks, BankName.MAERKI, currency, fallBackCurrency);
    }

    return account;
  }

  // --- HELPER METHODS --- //
  private getMatchingBank(banks: Bank[], bankName: string, currencyName: string, fallBackCurrencyName: string): Bank {
    return (
      banks.find((b) => b.name === bankName && b.currency === currencyName && b.receive) ??
      banks.find((b) => b.name === bankName && b.currency === fallBackCurrencyName && b.receive)
    );
  }
}
