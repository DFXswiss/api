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
      // Load the relations referenced by the BankTx.user getter so it resolves.
      // Transaction.user, BuyCrypto.transaction and BuyFiat.transaction are eager,
      // so the user chain cascades transitively from these top-level relations.
      entity.bankTx = await this.bankTxService.getBankTxById(dto.bankTxId, {
        transaction: true,
        buyCrypto: true,
        buyCryptoChargeback: true,
        buyFiats: true,
      });
      if (!entity.bankTx) throw new NotFoundException('BankTx not found');
      if (!entity.user) entity.user = entity.bankTx.user;
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

  async getAll(): Promise<Recall[]> {
    return this.repo.find({ relations: { bankTx: true, checkoutTx: true, user: true } });
  }

  async getById(id: number): Promise<Recall> {
    const entity = await this.repo.findOne({
      where: { id },
      relations: { bankTx: true, checkoutTx: true, user: true },
    });
    if (!entity) throw new NotFoundException('Recall not found');

    return entity;
  }
}
