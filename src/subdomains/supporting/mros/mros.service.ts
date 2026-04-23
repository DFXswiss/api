import { Injectable, NotFoundException } from '@nestjs/common';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Transaction } from '../payment/entities/transaction.entity';
import { TransactionService } from '../payment/services/transaction.service';
import { CreateMrosDto } from './dto/create-mros.dto';
import { UpdateMrosDto } from './dto/update-mros.dto';
import { Mros } from './mros.entity';
import { MrosRepository } from './mros.repository';

@Injectable()
export class MrosService {
  constructor(
    private readonly repo: MrosRepository,
    private readonly userDataService: UserDataService,
    private readonly transactionService: TransactionService,
  ) {}

  async create(dto: CreateMrosDto): Promise<Mros> {
    const { userDataId, indicators, transactionIds, ...rest } = dto;
    const entity = this.repo.create(rest);

    entity.userData = await this.userDataService.getUserData(userDataId);
    if (!entity.userData) throw new NotFoundException('UserData not found');

    if (indicators) entity.indicatorCodes = indicators;
    if (transactionIds) entity.transactions = await this.resolveTransactions(transactionIds);

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateMrosDto): Promise<Mros> {
    const entity = await this.repo.findOne({ where: { id }, relations: { transactions: true } });
    if (!entity) throw new NotFoundException('Mros not found');

    const { indicators, transactionIds, ...rest } = dto;
    Object.assign(entity, rest);
    if (indicators !== undefined) entity.indicatorCodes = indicators;
    if (transactionIds !== undefined) entity.transactions = await this.resolveTransactions(transactionIds);

    return this.repo.save(entity);
  }

  private async resolveTransactions(ids: number[]): Promise<Transaction[]> {
    const transactions = await this.transactionService.getTransactionsByIds(ids);
    if (transactions.length !== ids.length) throw new NotFoundException('One or more transactions not found');
    return transactions;
  }

  async getAll(): Promise<Mros[]> {
    return this.repo.find({ relations: { userData: true } });
  }

  async getById(id: number): Promise<Mros> {
    const entity = await this.repo.findOne({ where: { id }, relations: { userData: true } });
    if (!entity) throw new NotFoundException('Mros not found');

    return entity;
  }
}
