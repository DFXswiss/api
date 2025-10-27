import { Injectable, NotFoundException } from '@nestjs/common';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { CheckoutTxService } from '../fiat-payin/services/checkout-tx.service';
import { CreateRecallDto } from './dto/create-recall.dto';
import { UpdateRecallDto } from './dto/update-recall.dto';
import { Recall } from './recall.entity';
import { RecallRepository } from './recall.repository';

@Injectable()
export class RecallService {
  constructor(
    private readonly repo: RecallRepository,
    private readonly userService: UserService,
    private readonly bankTxService: BankTxService,
    private readonly checkoutTxService: CheckoutTxService,
  ) {}

  async create(dto: CreateRecallDto): Promise<Recall> {
    const entity = this.repo.create(dto);

    if (dto.userId) {
      entity.user = await this.userService.getUser(dto.userId);
      if (!entity.user) throw new NotFoundException('User not found');
    }

    if (dto.bankTxId) {
      entity.bankTx = await this.bankTxService.getBankTxById(dto.bankTxId);
      if (!entity.bankTx) throw new NotFoundException('BankTx not found');
    }

    if (dto.checkoutTxId) {
      entity.checkoutTx = await this.checkoutTxService.getCheckoutTx(dto.checkoutTxId);
      if (!entity.checkoutTx) throw new NotFoundException('CheckoutTx not found');
    }

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateRecallDto): Promise<Recall> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Recall not found');

    if (dto.userId) {
      entity.user = await this.userService.getUser(dto.userId);
      if (!entity.user) throw new NotFoundException('User not found');
    }

    return this.repo.save({ ...entity, ...dto });
  }
}
