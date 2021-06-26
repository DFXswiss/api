import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
export class AuthService {
  async createAuth(user: any): Promise<string> {
    return '1';
  }

  async findAuthByAddress(): Promise<string> {
    return '2';
  }

  async updateAuth(user: any): Promise<string> {
    return '3';
  }
}
