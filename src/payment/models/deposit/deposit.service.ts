import { Injectable } from '@nestjs/common';
import { DepositRepository } from 'src/payment/models/deposit/deposit.repository';
import { Blockchain, Deposit } from './deposit.entity';

@Injectable()
export class DepositService {
  constructor(private depositRepo: DepositRepository) {}

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOne(id);
  }

  async getAllDeposit(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getNextDeposit(blockchain: Blockchain = Blockchain.DEFICHAIN): Promise<Deposit> {
    // does not work with find options
    return this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchain = :blockchain', { blockchain })
      .getOne();
  }

  // Monitoring

  async getFreeDeposit(): Promise<number> {
    return this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL')
      .getCount();
  }
}
