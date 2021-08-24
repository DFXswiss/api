import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateBuyDto } from './dto/create-buy.dto';
import { Buy } from './buy.entity';
import { sha256 } from 'js-sha256';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { AssetRepository } from 'src/asset/asset.repository';
import { getManager } from 'typeorm';

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {
  async createBuy(createBuyDto: CreateBuyDto): Promise<any> {

    const assetObject = await getManager()
      .getCustomRepository(AssetRepository)
      .getAsset(createBuyDto.asset);

    const hash = sha256.create();
    hash.update(
      createBuyDto.user.address + assetObject.name + createBuyDto.iban,
    );
    createBuyDto.bankUsage =
      hash.toString().toUpperCase().slice(0, 4) +
      '-' +
      hash.toString().toUpperCase().slice(4, 8) +
      '-' +
      hash.toString().toUpperCase().slice(8, 12);

    createBuyDto.asset = assetObject;

    const buy = this.create(createBuyDto);
    const currentUser = await buy.user;
    buy.address = currentUser.address;
    try {
      if (buy) {
        await this.save(buy);

        delete buy.address;
        delete buy.user;
        delete buy["__user__"];
        delete buy["__userData__"];
        return buy;
      }
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<any> {
    try {
      const buy = await this.findOne(updateBuyDto.id);

      if (!buy) throw new NotFoundException('No matching entry for id found');
      
      if (buy.address != updateBuyDto.address)
        throw new ForbiddenException(
          'You can only change your own sell route',
        );
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

  async getBuy(id: any, user: any): Promise<any> {
    try {
      const buy = await this.findOne({ id: id.id });
      if (buy) {
        if (buy.user != user)
          throw new ForbiddenException('You can only get your own sell route');
        delete buy.user;
      }

      return buy;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAllBuy(user: any): Promise<any> {
    try {
      // const query = this.createQueryBuilder('buy');
      //   query.where({ address });
      //   query.innerJoinAndSelect('buy.asset','assetXYZ');

      // const buy = await query.getMany();

      const buy = await this.find({ user: user });

      if (buy) {
        for (let a = 0; a < buy.length; a++) {
          delete buy[a].user;
        }
      }

      return buy;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getBuyOrder(): Promise<any> {
    try {
      const buy = await this.find();
      return { buyOrder: buy.length };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAll(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
