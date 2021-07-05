import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/user.entity';
import { Repository } from 'typeorm';
import { Buy } from './buy.entity';

@Injectable()
export class BuyService {
  constructor(
    @InjectRepository(Buy)
    private buyRepository: Repository<Buy>,
  ) {}
  async createBuy(user: any): Promise<string> {
    return '1';
  }

  async getBuy(): Promise<Buy> {
    return this.buyRepository.findOne({"id": "8FhuD5a5qWYk5mtQnfMP7gF5oTaKMkMQQ1:0"});
  }

  async updateBuy(user: any): Promise<string> {
    return '3';
  }
}
