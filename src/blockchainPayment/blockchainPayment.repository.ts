import {
    BadRequestException,
    ConflictException,
    NotFoundException,
  } from '@nestjs/common';
  import { EntityRepository, Repository } from 'typeorm';
  import { CreateBlockchainPaymentDto } from './dto/create-blockchainPayment.dto';
  import { UpdateBlockchainPaymentDto } from './dto/update-blockchainPayment.dto';
  import { BlockchainPayment } from './blockchainPayment.entity';
  import { isString } from 'class-validator';
  
  @EntityRepository(BlockchainPayment)
  export class BlockchainPaymentRepository extends Repository<BlockchainPayment> {
    async createBlockchainPayment(createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<any> {
  
      const blockchainPayment = this.create(createBlockchainPaymentDto);
  
      try {
        await this.save(blockchainPayment);
      } catch (error) {
        throw new ConflictException(error.message);
      }
  
      return blockchainPayment;
    }
  
    async getAllBlockchainPayment(): Promise<any> {
      try {
        return await this.find();
      } catch (error) {
        throw new ConflictException(error.message);
      }
    }
  
    async getBlockchainPayment(key: any): Promise<any> {
      if (!isNaN(key.key)) {
        const blockchainPayment = await this.findOne({ id: key.key });
  
        if (blockchainPayment) return blockchainPayment;
      } else if (isString(key.key)) {
        let blockchainPayment = await this.findOne({ tx: key.key });
  
        if (blockchainPayment) return blockchainPayment;
  
        blockchainPayment = await this.findOne({ command: key.key });
  
        if (blockchainPayment) return blockchainPayment;
  
        throw new NotFoundException('No matching blockchainPayment found');
      } else if (!isNaN(key)) {
        const blockchainPayment = await this.findOne({ id: key });
  
        if (blockchainPayment) return blockchainPayment;
      } else if (isString(key)) {
        let blockchainPayment = await this.findOne({ tx: key });
  
        if (blockchainPayment) return blockchainPayment;
  
        blockchainPayment = await this.findOne({ command: key });
  
        if (blockchainPayment) return blockchainPayment;
  
        throw new NotFoundException('No matching blockchainPayment found');
      } else if (key.id) {
        const blockchainPayment = await this.findOne({ id: key.id });
  
        if (blockchainPayment) return blockchainPayment;
  
        throw new NotFoundException('No matching blockchainPayment found');
      } else if (key.tx) {
        const blockchainPayment = await this.findOne({ tx: key.tx });
  
        if (blockchainPayment) return blockchainPayment;
  
        throw new NotFoundException('No matching blockchainPayment found');
      } else if (key.command) {
        const blockchainPayment = await this.findOne({ command: key.command });
  
        if (blockchainPayment) return blockchainPayment;
  
        throw new NotFoundException('No matching blockchainPayment found');
      }
  
      throw new BadRequestException(
        'key must be number or string or JSON-Object',
      );
    }
  
    async updateBlockchainPayment(editBlockchainPaymentDto: UpdateBlockchainPaymentDto): Promise<any> {
      try {
        const currentCountry = await this.findOne({ id: editBlockchainPaymentDto.id });
        if (!currentCountry)
          throw new NotFoundException('No matching blockchainPayment found');
  
        return Object.assign(currentCountry, await this.save(editBlockchainPaymentDto));
      } catch (error) {
        throw new ConflictException(error.message);
      }
    }
  }