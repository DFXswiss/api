import { Injectable } from '@nestjs/common';
import * as BankInfos from 'src/payment/assets/bank-infos.json';
import { BankInfo } from './bank.entity';

@Injectable()
export class BankService {
  constructor(private readonly bankInfos = BankInfos as BankInfo[]) {}

  async getBankByBlz(blz: any): Promise<any> {
    let result = this.bankInfos.find(blz);
    return result;
  }

  async getBankByName(bankName: any): Promise<any> {
    let result = this.bankInfos.find(bankName);
    return result;
  }

  async getAllBank(): Promise<any> {
    return this.bankInfos;
  }
}
