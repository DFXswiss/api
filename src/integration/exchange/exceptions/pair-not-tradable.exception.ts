import { BadRequestException } from '@nestjs/common';

export class PairNotTradableException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}
