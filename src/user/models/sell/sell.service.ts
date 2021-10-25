import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSellDto } from 'src/user/models/sell/dto/create-sell.dto';
import { UpdateSellDto } from 'src/user/models/sell/dto/update-sell.dto';
import { SellRepository } from 'src/user/models/sell/sell.repository';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserService } from '../user/user.service';
import { Sell } from './sell.entity';
import { DepositService } from '../deposit/deposit.service';

@Injectable()
export class SellService {
  constructor(
    private readonly sellRepo: SellRepository,
    private readonly fiatService: FiatService,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
  ) {}

  async getSell(id: number, userId: number): Promise<Sell> {
    const sell = await this.sellRepo.findOne({ where: { id, user: { id: userId } } });
    if (!sell) throw new NotFoundException('No matching sell route for id found');

    return sell;
  }

  async getAllSell(userId: number): Promise<Sell[]> {
    return this.sellRepo.find({ user: { id: userId } });
  }

  async createSell(userId: number, dto: CreateSellDto): Promise<Sell> {
    // check user data
    const verification = await this.userService.verifyUser(userId);
    if (!verification.result) throw new ForbiddenException('User data missing');

    // check fiat
    const fiat = await this.fiatService.getFiat(dto.fiat.id);
    if (!fiat) throw new NotFoundException('No fiat for id found');

    // check if exists
    const existing = await this.sellRepo.findOne({ where: { iban: dto.iban, fiat: fiat } });
    if (existing) throw new ConflictException('Sell route already exists');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = await this.userService.getUser(userId);
    sell.deposit = await this.depositService.getNextDeposit();

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!sell) throw new NotFoundException('No matching entry found');

    return await this.sellRepo.save({ ...sell, ...dto });
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }
}
