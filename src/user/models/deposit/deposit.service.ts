import { Injectable } from '@nestjs/common';
import { DepositRepository } from 'src/user/models/deposit/deposit.repository';
import { Deposit } from './deposit.entity';

@Injectable()
export class DepositService {
  constructor(private depositRepo: DepositRepository) {}

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOne(id);
  }

  async getAllDeposit(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  // TODO: and staking is null!
  async getNextDeposit(): Promise<Deposit> {
    // does not work with find options
    return this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.sell', 'sell')
      .where('sell.id IS NULL')
      .getOne();
  }
}
