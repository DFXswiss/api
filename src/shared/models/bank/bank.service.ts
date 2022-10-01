import { Injectable } from '@nestjs/common';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';

@Injectable()
export class BankService {
  constructor(private bankRepo: BankRepository) {}

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.find();
  }

  async getBank(id: number): Promise<Bank> {
    return this.bankRepo.findOne(id);
  }

  async getBankByIbanBic(iban: string, bic: string): Promise<Bank> {
    return this.bankRepo.findOne({ iban: iban, bic: bic });
  }
}
