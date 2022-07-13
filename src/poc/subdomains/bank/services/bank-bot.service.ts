import { v4 as uuid } from 'uuid';
import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Interval } from '@nestjs/schedule';
import { Not, IsNull } from 'typeorm';
import { BankTransactionCompleteEvent } from '../events/bank-transaction-complete.event';
import { PocBuyCryptoRepository } from '../../buy/repositories/buy-crypto.repository';

@Injectable()
export class BankBotService {
  constructor(private readonly eventBus: EventBus, private readonly buyCryptoRepo: PocBuyCryptoRepository) {}

  @Interval(10000)
  async process() {
    const txInput = await this.buyCryptoRepo.find({
      where: {
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputReferenceAsset: IsNull(),
        outputReferenceAmount: IsNull(),
        outputAsset: IsNull(),
        isStarted: false,
      },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

    if (txInput.length === 0) {
      return;
    }

    for (const input of txInput) {
      console.log(`Dispatching BuyCrypto input. ID: ${input.id}`);

      await this.eventBus.publish(new BankTransactionCompleteEvent(uuid(), { buyCryptoId: input.id }));
      await this.buyCryptoRepo.save({ ...input, isStarted: true });
    }
  }
}
