import { Injectable, NotFoundException } from '@nestjs/common';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { In } from 'typeorm';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';
import { NodeClient } from 'src/integration/blockchain/ain/node/node-client';
import { KeyType } from 'src/shared/utils/util';

@Injectable()
export class CryptoInputService {
  constructor(readonly cryptoInputRepo: CryptoInputRepository) {}

  async update(cryptoInputId: number, dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    const cryptoInput = await this.cryptoInputRepo.findOne(cryptoInputId);
    if (!cryptoInput) throw new NotFoundException('CryptoInput not found');

    return await this.cryptoInputRepo.save({ ...cryptoInput, ...dto });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return await this.cryptoInputRepo.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: ['buyFiat', 'cryptoStaking', 'route', 'route.user'],
    });
  }

  async getCryptoInputByParam(
    paramName: KeyType<CryptoInput, any>,
    param: CryptoInput[keyof CryptoInput],
  ): Promise<CryptoInput> {
    return this.cryptoInputRepo
      .createQueryBuilder('cryptoInput')
      .select('cryptoInput')
      .leftJoinAndSelect('cryptoInput.route', 'route')
      .leftJoinAndSelect('route.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .where(`cryptoInput.${paramName} = :param`, { param: param })
      .getOne();
  }

  // --- HELPER METHODS --- //
  protected async checkNodeInSync(client: NodeClient): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }
}
