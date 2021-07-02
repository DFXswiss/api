import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deposit } from './deposit.entity';
export class DepositService {
  constructor(
    @InjectRepository(Deposit)
    private depositRepository: Repository<Deposit>,
  ) {}
  async createDeposit(user: any): Promise<string> {
    return '1';
  }

  async findDepositByAddress(): Promise<string> {
    return '2';
  }

  async updateDeposit(user: any): Promise<string> {
    return '3';
  }

  async findDepositByKey(key:any): Promise<string> {
    return '4';
  }
}
