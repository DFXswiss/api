import { Injectable, InternalServerErrorException } from '@nestjs/common';
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

  async getNextDeposit(blockchain: Blockchain): Promise<Deposit> {
    // does not work with find options
    const deposit = await this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchain = :blockchain', { blockchain })
      .getOne();
    if (!deposit) throw new InternalServerErrorException(`No unused deposit for ${blockchain} found`);

    return deposit;
  }
}
