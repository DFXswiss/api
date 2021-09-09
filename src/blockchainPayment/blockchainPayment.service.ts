import { Injectable } from '@nestjs/common';
import { BlockchainPaymentRepository } from 'src/blockchainPayment/blockchainPayment.repository';
import { UpdateBlockchainPaymentDto } from './dto/update-blockchainPayment.dto';
import { CreateBlockchainPaymentDto } from './dto/create-blockchainPayment.dto';

@Injectable()
export class BlockchainPaymentService {
  constructor(private blockchainPaymentRepository: BlockchainPaymentRepository) {}

  async createBlockchainPayment(createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<any> {
    return this.blockchainPaymentRepository.createBlockchainPayment(createBlockchainPaymentDto);
  }

  async getAllBlockchainPayment(): Promise<any> {
    return this.blockchainPaymentRepository.getAllBlockchainPayment();
  }

  async updateBlockchainPayment(blockchainPayment: UpdateBlockchainPaymentDto): Promise<string> {
    return this.blockchainPaymentRepository.updateBlockchainPayment(blockchainPayment);
  }

  async getBlockchainPayment(key: any): Promise<any> {
    return this.blockchainPaymentRepository.getBlockchainPayment(key);
  }
}