import { Injectable } from '@nestjs/common';
import { LogRepository } from './log.repository';
import { CreateLogDto } from './dto/create-log.dto';

@Injectable()
export class LogService {
  constructor(private logRepository: LogRepository) {}

  async createLog(createLogDto: CreateLogDto): Promise<any> {
    return this.logRepository.createLog(createLogDto);
  }

  async getAllLog(): Promise<any> {
    return this.logRepository.getAllLog();
  }

  async getAllUserLog(address: string): Promise<any> {
    return this.logRepository.getAllUserLog(address);
  }

  // async updateDeposit(update: any): Promise<any> {
  //   return this.depositRepository.updateDeposit(update);
  // }

  async getLog(key: any): Promise<any> {
    return this.logRepository.getLog(key);
  }
}
