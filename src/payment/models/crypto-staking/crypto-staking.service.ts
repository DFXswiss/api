import { Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/util';
import { CryptoStaking } from './crypto-staking.entity';
import { CryptoStakingRepository } from './crypto-staking.repository';
import { UpdateCryptoStakingDto } from './dto/update-crypto-staking.dto';

@Injectable()
export class CryptoStakingService {
  constructor(private readonly cryptoStakingRepo: CryptoStakingRepository) {}
  async update(id: number, dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    let entity = await this.cryptoStakingRepo.findOne(id, { relations: ['cryptoInput', 'cryptoInput.route'] });
    if (!entity) throw new NotFoundException('Crypto staking not found');
    const update = this.cryptoStakingRepo.create(dto);
    Util.removeNullFields(entity);
    entity = await this.cryptoStakingRepo.save({ ...update, ...entity });
    return entity;
  }
}
