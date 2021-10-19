import { Injectable } from '@nestjs/common';
import { DepositRepository } from 'src/user/models/deposit/deposit.repository';
import { CreateDepositDto } from 'src/user/models/deposit/dto/create-deposit.dto';
import { UpdateDepositDto } from './dto/update-deposit.dto';

@Injectable()
export class DepositService {
  constructor(private depositRepository: DepositRepository) {}

  async createDeposit(createDepositDto: CreateDepositDto): Promise<any> {
    return this.depositRepository.createDeposit(createDepositDto);
  }

  async getAllDeposit(): Promise<any> {
    return this.depositRepository.getAllDeposit();
  }

  async getNextDeposit(): Promise<any> {
    return this.depositRepository.getNextDeposit();
  }

  async updateDeposit(update: UpdateDepositDto): Promise<any> {
    return this.depositRepository.updateDeposit(update);
  }

  async getDeposit(key: any): Promise<any> {
    return this.depositRepository.getDeposit(key);
  }
}
