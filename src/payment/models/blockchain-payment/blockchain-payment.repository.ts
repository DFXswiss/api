import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateBlockchainPaymentDto } from './dto/create-blockchain-payment.dto';
import { UpdateBlockchainPaymentDto } from './dto/update-blockchain-payment.dto';
import { BlockchainPayment } from './blockchain-payment.entity';

@EntityRepository(BlockchainPayment)
export class BlockchainPaymentRepository extends Repository<BlockchainPayment> {
  async createBlockchainPayment(createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<BlockchainPayment> {
    const blockchainPayment = this.create(createBlockchainPaymentDto);

    try {
      await this.save(blockchainPayment);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return blockchainPayment;
  }

  async updateBlockchainPayment(editBlockchainPaymentDto: UpdateBlockchainPaymentDto): Promise<BlockchainPayment> {
    const currentPayment = await this.findOne({ id: editBlockchainPaymentDto.id });
    if (!currentPayment) throw new NotFoundException('No matching blockchain payment found');

    return Object.assign(currentPayment, await this.save(editBlockchainPaymentDto));
  }
}
