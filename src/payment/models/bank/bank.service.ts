import { Injectable } from '@nestjs/common';

@Injectable()
export class BankService {
  constructor() {}

  async getBankByBlz(blz: any): Promise<any> {}

  async getBankByName(bankName: any): Promise<any> {}

  async getAllBank(): Promise<any> {}
}
