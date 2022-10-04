import { Injectable } from '@nestjs/common';
import { KycCompleted, KycStatus } from 'src/user/models/user-data/user-data.entity';
import { CountryService } from '../country/country.service';
import { Fiat } from '../fiat/fiat.entity';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';

export interface BankSelectorInput {
  amount: number;
  currency: Fiat;
  iban: string;
  sctInst: boolean;
  kycStatus: KycStatus;
}

@Injectable()
export class BankService {
  constructor(private bankRepo: BankRepository, private countryService: CountryService) {}

  async getAllBanks(): Promise<Bank[]> {
    return await this.bankRepo.find();
  }

  // --- BankSelector --- //
  async getBank(bankSelectorInput: BankSelectorInput): Promise<Bank> {
    let account: Bank;

    const frickAmountLimit = 9000;
    const fallBackCurrency = 'EUR';

    const ibanCodeCountry = await this.countryService.getCountryWithSymbol(bankSelectorInput.iban.substring(0, 2));

    const banks = await this.bankRepo.find();

    // select the matching bank account
    if (bankSelectorInput.amount > frickAmountLimit || bankSelectorInput.currency.name === 'USD') {
      // amount > 9k => Frick || USD => Frick
      account = this.getMatchingBank(banks, 'Bank Frick', bankSelectorInput.currency.name, fallBackCurrency);
    }
    if (
      !account &&
      bankSelectorInput.currency.name === 'EUR' &&
      bankSelectorInput.sctInst &&
      KycCompleted(bankSelectorInput.kycStatus)
    ) {
      // instant => Olkypay / EUR
      account = this.getMatchingBank(banks, 'Olkypay', bankSelectorInput.currency.name, fallBackCurrency);
    }
    if (!account && ibanCodeCountry.maerkiBaumannEnable) {
      // Valid Maerki Baumann country => MB CHF/USD/EUR
      account = this.getMatchingBank(banks, 'Maerki Baumann', bankSelectorInput.currency.name, fallBackCurrency);
    }
    if (!account) {
      // Default => Frick
      account = this.getMatchingBank(banks, 'Bank Frick', bankSelectorInput.currency.name, fallBackCurrency);
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
