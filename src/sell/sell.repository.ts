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
import { UserRepository } from 'src/user/user.repository';

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {
  async createSell(createSellDto: CreateSellDto): Promise<any> {
    if (createSellDto.id) delete createSellDto['id'];

    const userObject = await getManager()
    .getCustomRepository(UserRepository)
    .verifyUser(createSellDto.address);

    if(!userObject.result) throw new ForbiddenException( "user data missing, verify");

    const fiatObject = await getManager()
      .getCustomRepository(FiatRepository)
      .getFiat(createSellDto.fiat);

    const depositObject = await getManager()
      .getCustomRepository(DepositRepository)
      .getNextDeposit();

    createSellDto.deposit = depositObject.id;
    createSellDto.fiat = fiatObject.id;

    const sell = this.create(createSellDto);

    if (sell) {
      await this.save(sell);

      sell.fiat = fiatObject;
      sell.deposit = depositObject;
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

        sell.deposit = await getManager()
          .getCustomRepository(DepositRepository)
          .getDeposit(sell.deposit);
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

      if (sell) {

        for(let a = 0; a < sell.length; a++){

          sell[a].fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(sell[a].fiat);

          sell[a].deposit = await getManager()
          .getCustomRepository(DepositRepository)
          .getDeposit(sell[a].deposit);

          delete sell[a]['address'];

        }
      }

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

        sell.deposit = await getManager()
          .getCustomRepository(DepositRepository)
          .getDeposit(sell.deposit);
      }

      delete sell['address'];
      return sell;
    }

    throw new BadRequestException('id must be a number');
  }
}
