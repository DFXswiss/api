import { Injectable } from '@nestjs/common';
import * as BankInfo from 'src/payment/assets/bankInfo.json';

@Injectable()
export class BankService {
  constructor() {}

  async getBankByBlz(blz: any): Promise<any> {}

  async getBankByName(bankName: any): Promise<any> {
    //return await
  }

  async getAllBank(): Promise<any> {
    return BankInfo;
  }
}
