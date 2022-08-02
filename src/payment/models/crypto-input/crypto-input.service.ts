import { Injectable, NotFoundException } from '@nestjs/common';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { In } from 'typeorm';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';
import { NodeClient } from 'src/ain/node/node-client';
import { CryptoInputHistoryDto } from './dto/crypto-input-history.dto';

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

  async getHistory(userId: number, routeId: number): Promise<CryptoInputHistoryDto[]> {
    return this.cryptoInputRepo
      .find({
        where: { route: { id: routeId, user: { id: userId } } },
        relations: ['buyCrypto'],
      })
      .then((inputs) => inputs.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //
  protected async checkNodeInSync(client: NodeClient): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }

  private toHistoryDto(input: CryptoInput): CryptoInputHistoryDto {
    return {
      inputAmount: input.amount,
      inputAsset: input.asset.dexName,
      outputAmount: input.buyCrypto.outputAmount,
      outputAsset: input.buyCrypto.outputAsset,
      txId: input.buyCrypto.txId,
      date: input.created,
      amlCheck: input.amlCheck,
      isComplete: input.buyCrypto.isComplete,
    };
  }
}
