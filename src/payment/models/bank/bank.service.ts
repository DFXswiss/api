import { Injectable } from '@nestjs/common';
import * as bankInfo from 'src/payment/assets/bankInfo.json';

@Injectable()
export class BankService {
  constructor() {}

  async getBankByBlz(blz: any): Promise<any> {}

  async getBankByName(bankName: any): Promise<any> {}

  async getAllBank(): Promise<any> {
    return bankInfo;
  }
}
