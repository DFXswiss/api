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
import { GetDepositDto } from "./dto/get-deposit.dto";
import { UpdateDepositDto } from "./dto/update-deposit.dto";

@Injectable()
export class DepositService {
  constructor(private depositRepository: DepositRepository) {}

  async createDeposit(createDepositDto: CreateDepositDto): Promise<any>{
    return this.depositRepository.createDeposit(createDepositDto);
  }

  async getAllDeposit(): Promise<any>{
    return this.depositRepository.getAllDeposit();
  }

  async getNextDeposit(): Promise<any> {
    return this.depositRepository.getNextDeposit();
  }

  async updateDeposit(update: UpdateDepositDto): Promise<any> {
    return this.depositRepository.updateDeposit(update);
  }

  async getDeposit(key: GetDepositDto): Promise<any> {
    return this.depositRepository.getDeposit(key);
  }
}
