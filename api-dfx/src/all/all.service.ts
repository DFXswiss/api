import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
export class AllService {
  async createAll(user: any): Promise<string> {
    return '1';
  }

  async findAllByAddress(): Promise<string> {
    return '2';
  }

  async updateAll(user: any): Promise<string> {
    return '3';
  }
}
