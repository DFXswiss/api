import { Injectable, NotFoundException } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeType } from 'src/ain/node/node.service';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { In } from 'typeorm';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';
import { NodeNotAccessibleError } from 'src/payment/exceptions/node-not-accessible.exception';
import { NodeClient } from 'src/ain/node/node-client';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class CryptoInputService {
  constructor(readonly cryptoInputRepo: CryptoInputRepository, readonly http: HttpService) {}

  async update(cryptoInputId: number, dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    const cryptoInput = await this.cryptoInputRepo.findOne(cryptoInputId);
    if (!cryptoInput) throw new NotFoundException('CryptoInput not found');

    return await this.cryptoInputRepo.save({ ...cryptoInput, ...dto });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return await this.cryptoInputRepo.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: ['cryptoSell', 'cryptoStaking', 'route', 'route.user'],
    });
  }

  // --- INPUT HANDLING --- //

  async getReferenceAmounts(
    asset: string,
    amount: number,
    client: DeFiClient,
    allowRetry = true,
  ): Promise<{ btcAmount: number; usdtAmount: number }> {
    try {
      const btcAmount = await client.testCompositeSwap(asset, 'BTC', amount);
      const usdtAmount = await client.testCompositeSwap(asset, 'USDT', amount);

      return { btcAmount, usdtAmount };
    } catch (e) {
      try {
        // poll the node
        await client.getInfo();
      } catch (nodeError) {
        throw new NodeNotAccessibleError(NodeType.INPUT, nodeError);
      }

      if (allowRetry) {
        // try once again
        console.log('Retrying testCompositeSwaps after node poll success');
        return await this.getReferenceAmounts(asset, amount, client, false);
      }

      // re-throw error, likely input related
      throw e;
    }
  }

  protected async callApi<T>(url: string): Promise<T> {
    return this.http.get<T>(url, { tryCount: 3 });
  }

  // --- HELPER METHODS --- //
  protected async checkNodeInSync(client: NodeClient): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }
}
