import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { UpdateDepositDto } from './dto/update-deposit.dto';
import { Deposit } from './deposit.entity';
import { isString } from 'class-validator';

@EntityRepository(Deposit)
export class DepositRepository extends Repository<Deposit> {
  async createDeposit(createDepositDto: CreateDepositDto): Promise<any> {

    const deposit = this.create(createDepositDto);

    try {
      await this.save(deposit);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return deposit;
  }

  async getAllDeposit(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateDeposit(depositAddress: UpdateDepositDto): Promise<any> {
    try {
      const currentDeposit = await this.findOne({ id: depositAddress.id });

      if (!currentDeposit)
        throw new NotFoundException('No matching deposit address for id found');

      return Object.assign(currentDeposit, await this.save(depositAddress));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getNextDeposit(): Promise<any> {
    try {
      const nextAddress = await this.findOne({ used: false });
      if (!nextAddress)
        throw new NotFoundException(
          'No available deposit address. Please contact support!',
        );

      nextAddress.used = true;

      await this.save(nextAddress);
      return nextAddress;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getDeposit(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      const asset = await this.findOne({ id: key.key });
      if (asset) return asset;
    } else if (isString(key.key)) {
      const asset = await this.findOne({ address: key.key });
      if (asset) return asset;
    } else if (!isNaN(key)) {
      const asset = await this.findOne({ id: key });
      if (asset) return asset;
    } else if (isString(key)) {
      const asset = await this.findOne({ address: key });
      if (asset) return asset;
    }

    throw new NotFoundException('No matching deposit address for id found');
  }
}
