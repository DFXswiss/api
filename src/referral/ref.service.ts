import { Injectable } from '@nestjs/common';
import { CreateRefDto } from './dto/create-ref.dto';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  constructor(private refRepository: RefRepository) {}

  async createRef(createRefDto: CreateRefDto): Promise<any> {
    return this.refRepository.createRef(createRefDto);
  }

  async getRef(wallet: any): Promise<any> {
    return this.refRepository.getRef(wallet);
  }
}