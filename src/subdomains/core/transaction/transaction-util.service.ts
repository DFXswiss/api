import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CheckStatus } from '../aml/enums/check-status.enum';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';

export class TransactionUtilService {
  static validateRefund(entity: BuyCrypto | BuyFiat, refundUser: User, chargebackAmount?: number): void {
    if (!refundUser) throw new NotFoundException('Your refund user was not found');
    if (entity.userData.id !== refundUser.userData.id)
      throw new ForbiddenException('You can only refund to your own addresses');
    if (!refundUser.blockchains.includes(entity.cryptoInput.asset.blockchain))
      throw new BadRequestException('You can only refund to a address on the origin blockchain');
    if (
      entity.chargebackAllowedDate ||
      entity.chargebackDate ||
      (entity instanceof BuyFiat && entity.chargebackTxId) ||
      (entity instanceof BuyCrypto && entity.chargebackCryptoTxId)
    )
      throw new BadRequestException('Transaction is already returned');
    if (entity.amlCheck !== CheckStatus.FAIL || entity.outputAmount)
      throw new BadRequestException('Only failed transactions are refundable');
    if (chargebackAmount && chargebackAmount > entity.inputAmount)
      throw new BadRequestException('You can not refund more than the input amount');
  }
}
