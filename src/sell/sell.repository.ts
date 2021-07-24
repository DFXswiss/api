import {
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { Sell } from './sell.entity';
import { DepositRepository } from 'src/deposit/deposit.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { getManager } from 'typeorm';

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {
  async createSell(createSellDto: CreateSellDto): Promise<any> {
    if (createSellDto.id) delete createSellDto['id'];

    const fiatObject = await getManager()
      .getCustomRepository(FiatRepository)
      .getFiat(createSellDto.fiat);

    const depositObject = await getManager()
      .getCustomRepository(DepositRepository)
      .getNextDeposit();

    createSellDto.depositId = depositObject.id;
    createSellDto.fiat = fiatObject.id;

    const sell = this.create(createSellDto);

    if (sell) {
      await this.save(sell);

      sell.fiat = fiatObject;
      sell.depositId = depositObject;
      delete sell['address'];
    }
    return sell;
  }

  async updateSell(sellDto: UpdateSellDto): Promise<any> {
    try {
      const currentSell = await this.findOne({ id: sellDto.id });

      if (!currentSell)
        throw new NotFoundException('No matching entry for id found');
      if (sellDto.address != currentSell.address)
        throw new ForbiddenException('You can only change your own sell route');

      currentSell.active = sellDto.active;

      const sell = await this.save(currentSell);

      if (sell) {
        sell.fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(sell.fiat);

        sell.depositId = await getManager()
          .getCustomRepository(DepositRepository)
          .getDeposit(sell.depositId);
      }
      delete sell['address'];
      return sell;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }
  }

  async getAllSell(address: string): Promise<any> {
    try {
      const sell = await this.find({ address: address });
      //TODO Schleife durch alle sell und asset id mit objekt ersetzen
      // + Adresse löschen
      return sell;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }
  }

  async getSell(id: any, address: string): Promise<any> {
    if (!isNaN(id.id)) {
      let sell = await this.findOne({ id: id.id });

      if (sell) {
        if (sell.address != address)
          throw new ForbiddenException('You can only get your own sell route');

        sell.fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(sell.fiat);

        sell.depositId = await getManager()
          .getCustomRepository(DepositRepository)
          .getDeposit(sell.depositId);
      }

      delete sell['address'];
      return sell;
    }

    throw new BadRequestException('id must be a number');
  }
}
