import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FiatPaymentMethod } from '../../payment/dto/payment-method.enum';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';
import { IbanBankName } from './dto/bank.dto';

export interface BankSelectorInput {
  amount: number;
  currency: string;
  paymentMethod: FiatPaymentMethod;
  userData: UserData;
}

@Injectable()
export class BankService {
  constructor(private bankRepo: BankRepository) {}

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.findCached(`all`);
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
    return this.bankRepo.findOneCachedBy(`${currency}`, { currency, send: true });
  }

  // --- BankSelector --- //
  async getBank({ amount, currency, paymentMethod, userData }: BankSelectorInput): Promise<Bank> {
    const frickAmountLimit = 9000;
    const fallBackCurrency = 'EUR';

    const banks = await this.getAllBanks();

    // select the matching bank account
    let account: Bank;

    if (paymentMethod === FiatPaymentMethod.INSTANT) {
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
      // Default => MB
      account = this.getMatchingBank(banks, IbanBankName.MAERKI, currency, fallBackCurrency);
    }

    return account;
  }

  static isBankMatching(asset: Asset, accountIban: string): boolean {
    switch (asset.blockchain as string) {
      case 'MaerkiBaumann':
        return (
          (asset.dexName === 'EUR' && accountIban === 'CH6808573177975201814') ||
          (asset.dexName === 'CHF' && accountIban === 'CH3408573177975200001')
        );

      case 'Olkypay':
        return accountIban === 'LU116060002000005040';
    }
  }

  // --- HELPER METHODS --- //
  private getMatchingBank(banks: Bank[], bankName: string, currencyName: string, fallBackCurrencyName: string): Bank {
    return (
      banks.find((b) => b.name === bankName && b.currency === currencyName && b.receive) ??
      banks.find((b) => b.name === bankName && b.currency === fallBackCurrencyName && b.receive)
    );
  }
}
