import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deposit } from './deposit.entity';
import { DepositRepository } from 'src/deposit/deposit.repository';
import { CreateDepositDto } from 'src/deposit/dto/create-deposit.dto';

@Injectable()
export class DepositService {
  constructor(private depositRepository: DepositRepository) {}

  async createDeposit(createDepositDto: CreateDepositDto): Promise<void>{
    this.depositRepository.createDeposit(createDepositDto);
  }

  // async createDeposit(user: any): Promise<string> {
  //   return '1';
  // }

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
