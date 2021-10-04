import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateBuyDto } from './dto/create-buy.dto';
import { Buy } from './buy.entity';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { createHash } from 'crypto';
import { AssetService } from 'src/shared/models/asset/asset.service';

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {
  async createBuy(createBuyDto: CreateBuyDto, assetService: AssetService): Promise<Buy> {
    const assetObject = await assetService.getAsset(createBuyDto.asset);
    createBuyDto.asset = assetObject;

    const hash = createHash('sha256');
    hash.update(createBuyDto.user.address + assetObject.name + createBuyDto.iban);
    const hexHash = hash.digest('hex').toUpperCase();

    createBuyDto.bankUsage = `${hexHash.slice(0, 4)}-${hexHash.slice(4, 8)}-${hexHash.slice(8, 12)}`;

    createBuyDto.iban = createBuyDto.iban.split(' ').join('');

    const buy = this.create(createBuyDto);
    const currentUser = buy.user;
    buy.address = currentUser.address;
    try {
      if (buy) {
        await this.save(buy);

        delete buy.address;
        delete buy.user;
        return buy;
      }
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<Buy> {
    try {
      const buy = await this.findOne(updateBuyDto.id);

      if (!buy) throw new NotFoundException('No matching entry for id found');

      if (buy.address != updateBuyDto.address) throw new ForbiddenException('You can only change your own sell route');
      buy.active = updateBuyDto.active;
      await this.save(buy);
      delete buy.address;
      delete buy.user;
      return buy;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getBuyByBankUsage(bankUsage: string): Promise<Buy> {
    try {
      const buy = await this.findOne({ bankUsage: bankUsage });
      if (buy) return buy;

      return;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
