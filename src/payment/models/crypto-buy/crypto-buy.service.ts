import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Buy } from 'src/user/models/buy/buy.entity';
import { BuyService } from 'src/user/models/buy/buy.service';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { CryptoBuy } from './crypto-buy.entity';
import { CryptoBuyRepository } from './crypto-buy.repository';
import { CryptoBuyDto } from './dto/crypto-buy.dto';

@Injectable()
export class CryptoBuyService {
  constructor(
    private readonly cryptoBuyRepo: CryptoBuyRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyService: BuyService,
  ) {}

  async create(dto: CryptoBuyDto): Promise<CryptoBuy> {
    let entity = await this.cryptoBuyRepo.findOne({ bankTx: { id: dto.bankTxId } });
    if (entity) throw new ConflictException('There is already a crypto buy for the specified bank TX');

    entity = await this.createEntity(dto);
    return this.cryptoBuyRepo.save(entity);
  }

  async update(id: number, dto: CryptoBuyDto): Promise<CryptoBuy> {
    const entity = await this.cryptoBuyRepo.findOne(id);
    if (!entity) throw new NotFoundException('No matching entry found');

    const update = await this.createEntity(dto);

    return await this.cryptoBuyRepo.save({ ...entity, ...update });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CryptoBuyDto): Promise<CryptoBuy> {
    const cryptoBuy = this.cryptoBuyRepo.create(dto);
    cryptoBuy.bankTx = await this.getBankTx(dto);
    cryptoBuy.buy = await this.getBuy(dto);

    return cryptoBuy;
  }

  private async getBankTx(dto: CryptoBuyDto): Promise<BankTx | undefined> {
    if (!dto.bankTxId) return undefined;

    const bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
    if (!bankTx) throw new NotFoundException('No bank TX for ID found');
    return bankTx;
  }

  private async getBuy(dto: CryptoBuyDto): Promise<Buy | undefined> {
    if (!dto.buyId) return undefined;

    const buy = await this.buyService.getBuy(dto.buyId);
    if (!buy) throw new NotFoundException('No buy for ID found');
    return buy;
  }
}
