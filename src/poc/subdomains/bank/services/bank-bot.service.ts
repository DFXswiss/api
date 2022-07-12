import { v4 as uuid } from 'uuid';
import { throttle } from 'lodash';
import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Interval } from '@nestjs/schedule';
import { Not, IsNull } from 'typeorm';
import { BankTransactionCompleteEvent } from '../events/bank-transaction-complete.event';
import { PocBuyCryptoRepository } from '../../buy/repositories/buy-crypto.repository';

@Injectable()
export class BankBotService {
  constructor(private readonly eventBus: EventBus, private readonly buyCryptoRepo: PocBuyCryptoRepository) {}

  @Interval(60000)
  async process() {
    const txInput = await this.buyCryptoRepo.find({
      where: {
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputReferenceAsset: IsNull(),
        outputReferenceAmount: IsNull(),
        outputAsset: IsNull(),
        batch: IsNull(),
      },
      relations: ['bankTx', 'buy', 'buy.user', 'batch'],
    });

    if (txInput.length === 0) {
      return;
    }

    txInput.forEach((input) =>
      throttle(() => this.eventBus.publish(new BankTransactionCompleteEvent(uuid(), { buyCryptoId: input.id })), 1000),
    );
  }
}
