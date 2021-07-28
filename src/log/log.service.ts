import {
    BadRequestException,
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
  import { Log } from './log.entity';
  import { LogRepository } from './log.repository';
  import { CreateLogDto } from './dto/create-log.dto';
  import { UpdateLogDto } from "./dto/update-log.dto";
  
  @Injectable()
  export class LogService {
    constructor(private logRepository: LogRepository) {}
  
    async createLog(createLogDto: CreateLogDto): Promise<any>{
      return this.logRepository.createLog(createLogDto);
    }
  
    async getAllLog(): Promise<any>{
      return this.logRepository.getAllLog();
    }
  
    // async updateDeposit(update: any): Promise<any> {
    //   return this.depositRepository.updateDeposit(update);
    // }
  
    async getLog(key: any): Promise<any> {
      return this.logRepository.getLog(key);
    }
  }