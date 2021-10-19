import { NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { EntityRepository, Repository, getManager } from 'typeorm';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { Sell } from './sell.entity';
import { DepositRepository } from 'src/user/models/deposit/deposit.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { FiatService } from 'src/shared/models/fiat/fiat.service';

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {
  async createSell(createSellDto: CreateSellDto, fiatService: FiatService): Promise<any> {
    const userObject = await getManager().getCustomRepository(UserRepository).verifyUser(createSellDto.user.address);

    if (!userObject.result) throw new ForbiddenException('user data missing, verify');

    const fiatObject = await fiatService.getFiat(createSellDto.fiat);

    const depositObject = await getManager().getCustomRepository(DepositRepository).getNextDeposit();

    createSellDto.deposit = depositObject.id;
    createSellDto.fiat = fiatObject.id;

    const sell = this.create(createSellDto);
    sell.address = createSellDto.user.address;
    if (sell) {
      await this.save(sell);

      sell.fiat = fiatObject;
      sell.deposit = depositObject;
      delete sell.user;
      delete sell.address;
    }
    return sell;
  }

  async updateSell(sellDto: UpdateSellDto): Promise<any> {
    try {
      const currentSell = await this.findOne({ id: sellDto.id });

      if (!currentSell) throw new NotFoundException('No matching entry for id found');
      if (sellDto.address != currentSell.address)
        throw new ForbiddenException('You can only change your own sell route');

      currentSell.active = sellDto.active;

      const sell = await this.save(currentSell);

      delete sell.user;
      delete sell.address;

      return sell;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAllSell(address: string): Promise<any> {
    try {
      const sell = await this.find({ address: address });

      if (sell) {
        for (let a = 0; a < sell.length; a++) {
          delete sell[a].user;
          delete sell[a].address;
        }
      }

      return sell;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getSell(id: any, address: string): Promise<any> {
    if (!isNaN(id.id)) {
      const sell = await this.findOne({ id: id.id });

      if (sell) {
        if (sell.address != address) throw new ForbiddenException('You can only get your own sell route');
      }
      delete sell.user;
      delete sell.address;
      return sell;
    }
    throw new BadRequestException('id must be a number');
  }

  async getSellOrder(): Promise<number> {
    try {
      const sell = await this.find();
      return sell.length;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
