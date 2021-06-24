import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Fiat } from './fiat.entity';
export class FiatService {
  async createFiat(user: any): Promise<string> {
    return '1';
  }

  async findFiatByAddress(): Promise<string> {
    return '2';
  }

  async updateFiat(user: any): Promise<string> {
    return '3';
  }

  async findFiatByKey(key:any): Promise<string> {
    return '4';
  }
}
