import { Injectable } from '@nestjs/common';
import { BlockchainPaymentRepository } from 'src/payment/models/blockchain-payment/blockchain-payment.repository';
import { UpdateBlockchainPaymentDto } from './dto/update-blockchain-payment.dto';
import { CreateBlockchainPaymentDto } from './dto/create-blockchain-payment.dto';
import { BlockchainPayment } from './blockchain-payment.entity';

@Injectable()
export class BlockchainPaymentService {
  constructor(private blockchainPaymentRepository: BlockchainPaymentRepository) {}

  async createBlockchainPayment(createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<BlockchainPayment> {
    return this.blockchainPaymentRepository.createBlockchainPayment(createBlockchainPaymentDto);
  }

  async getAllBlockchainPayment(): Promise<BlockchainPayment[]> {
    return this.blockchainPaymentRepository.find();
  }

  async updateBlockchainPayment(blockchainPayment: UpdateBlockchainPaymentDto): Promise<BlockchainPayment> {
    return this.blockchainPaymentRepository.updateBlockchainPayment(blockchainPayment);
  }

  async getBlockchainPayment(id: number): Promise<BlockchainPayment> {
    return this.blockchainPaymentRepository.findOne(id);
  }
}
