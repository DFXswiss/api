import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { Wallet } from './wallet.entity';
import { isString } from 'class-validator';

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {
  async createWallet(createWalletDto: CreateWalletDto): Promise<any> {
    if (createWalletDto.id) delete createWalletDto.id;
    if (createWalletDto.created) delete createWalletDto.created;

    const wallet = this.create(createWalletDto);

    try {
      await this.save(wallet);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return wallet;
  }

  async getAllWallet(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getWallet(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      const asset = await this.findOne({ id: key.key });

      if (asset) return asset;
    } else if (isString(key.key)) {
      const asset = await this.findOne({ address: key.key });

      if (asset) return asset;

      throw new NotFoundException('No matching wallet found');
    }

    throw new BadRequestException(
      'key must be number or a string or JSON-Object',
    );
  }

  async updateWallet(editWalletDto: UpdateWalletDto): Promise<any> {
    try {
      const currentWallet = await this.findOne({ id: editWalletDto.id });

      if (!currentWallet)
        throw new NotFoundException('No matching wallet for id found');

      if (editWalletDto.created) delete editWalletDto.created;

      return Object.assign(currentWallet, await this.save(editWalletDto));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
