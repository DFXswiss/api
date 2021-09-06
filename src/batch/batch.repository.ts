import {
    BadRequestException,
    ConflictException,
    NotFoundException,
  } from '@nestjs/common';
  import { EntityRepository, Repository } from 'typeorm';
  import { CreateBatchDto } from './dto/create-batch.dto';
  import { UpdateBatchDto } from './dto/update-batch.dto';
  import { Batch } from './batch.entity';
  import { isString } from 'class-validator';
  
  @EntityRepository(Batch)
  export class BatchRepository extends Repository<Batch> {
    async createBatch(createBatchDto: CreateBatchDto): Promise<any> {
  
      const batch = this.create(createBatchDto);
  
      try {
        await this.save(batch);
      } catch (error) {
        throw new ConflictException(error.message);
      }
  
      return batch;
    }
  
    async getAllBatch(): Promise<any> {
      try {
        return await this.find();
      } catch (error) {
        throw new ConflictException(error.message);
      }
    }
  
    async getBatch(key: any): Promise<any> {
      if (!isNaN(key.key)) {
        const batch = await this.findOne({ id: key.key });
  
        if (batch) return batch;
      } else if (isString(key.key)) {
        let batch = await this.findOne({ name: key.key });
  
        if (batch) return batch;
  
        throw new NotFoundException('No matching batch found');
      } else if (!isNaN(key)) {
        const batch = await this.findOne({ id: key });
  
        if (batch) return batch;

        throw new NotFoundException('No matching batch found');
      } else if (isString(key)) {
        let batch = await this.findOne({ name: key });
  
        if (batch) return batch;
  
        throw new NotFoundException('No matching batch found');
      } else if (key.id) {
        const batch = await this.findOne({ id: key.id });
  
        if (batch) return batch;
  
        throw new NotFoundException('No matching batch found');
      } else if (key.name) {
        const batch = await this.findOne({ name: key.symbol });
  
        if (batch) return batch;
  
        throw new NotFoundException('No matching batch found');
      }
  
      throw new BadRequestException(
        'key must be number or string or JSON-Object',
      );
    }
  
    async updateBatch(editBatchDto: UpdateBatchDto): Promise<any> {
      try {
        const currentCountry = await this.findOne({ id: editBatchDto.id });
        if (!currentCountry)
          throw new NotFoundException('No matching batch found');
  
        return Object.assign(currentCountry, await this.save(editBatchDto));
      } catch (error) {
        throw new ConflictException(error.message);
      }
    }
  }
  