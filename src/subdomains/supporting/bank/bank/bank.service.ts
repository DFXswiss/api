import { Injectable } from '@nestjs/common';
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
  constructor(private bankRepo: BankRepository, private countryService: CountryService) {}

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.find();
  }

  async getBankInternal(name: BankName, currency: string): Promise<Bank> {
    return this.bankRepo.findOneBy({ name, currency });
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
      if (userData.hasBankTxVerification) {
        account = this.getMatchingBank(banks, BankName.REVOLUT, currency, fallBackCurrency);
      } else {
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
