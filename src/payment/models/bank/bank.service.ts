import { Injectable } from '@nestjs/common';
import * as BankInfos from 'src/payment/assets/bank-infos.json';
import { BankInfo } from './bank.dto';

@Injectable()
export class BankService {
  constructor() {}

  private readonly bankInfos = BankInfos as BankInfo[];

  // async getBankById(id: number): Promise<any> {
  //   let result = this.bankInfos[id];
  //   return result;
  // }

  async getBankByName(bankName: any): Promise<any> {
    let result = this.bankInfos.find((l) => l.Bezeichnung == bankName);
    if (!result) result = this.bankInfos.find((l) => l.Kurzbezeichnung == bankName);
    return result;
  }

  async getBankByBlz(blz: any): Promise<any> {
    let result = this.bankInfos.find((l) => l.Bankleitzahl == blz);
    return result;
  }

  async getAllBank(): Promise<any> {
    return this.bankInfos;
  }
}
