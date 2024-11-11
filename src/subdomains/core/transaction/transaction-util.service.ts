import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BigNumber } from 'ethers/lib/ethers';
import * as IbanTools from 'ibantools';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { CryptoInput, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { CheckStatus } from '../aml/enums/check-status.enum';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { Swap } from '../buy-crypto/routes/swap/swap.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import { ConfirmDto } from '../sell-crypto/route/dto/confirm.dto';
import { Sell } from '../sell-crypto/route/sell.entity';

export type RefundValidation = {
  refundIban?: string;
  refundUser?: User;
  chargebackAmount?: number;
};

@Injectable()
export class TransactionUtilService {
  constructor(
    private readonly assetService: AssetService,
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly payInService: PayInService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  static validateRefund(entity: BuyCrypto | BuyFiat, dto: RefundValidation): void {
    if (entity.cryptoInput) {
      if (!dto.refundUser) throw new NotFoundException('Your refund user was not found');
      if (entity.userData.id !== dto.refundUser.userData.id)
        throw new ForbiddenException('You can only refund to your own addresses');
      if (!dto.refundUser.blockchains.includes(entity.cryptoInput.asset.blockchain))
        throw new BadRequestException('You can only refund to a address on the origin blockchain');
    } else if (entity instanceof BuyCrypto && entity.checkoutTx) {
      if (
        [
          CheckoutPaymentStatus.REFUNDED,
          CheckoutPaymentStatus.REFUND_PENDING,
          CheckoutPaymentStatus.PARTIALLY_REFUNDED,
        ].includes(entity.checkoutTx.status)
      )
        throw new BadRequestException('CheckoutTx already refunded');
    } else {
      if (!dto.refundIban) throw new BadRequestException('Missing refund iban');
      if (!IbanTools.validateIBAN(dto.refundIban).valid) throw new BadRequestException('Refund iban not valid');
    }

    if (
      entity.chargebackAllowedDate ||
      entity.chargebackDate ||
      (entity instanceof BuyFiat && entity.chargebackTxId) ||
      (entity instanceof BuyCrypto && (entity.chargebackCryptoTxId || entity.chargebackBankTx))
    )
      throw new BadRequestException('Transaction is already returned');
    if (![CheckStatus.FAIL, CheckStatus.PENDING].includes(entity.amlCheck) || entity.outputAmount)
      throw new BadRequestException('Only failed or pending transactions are refundable');
    if (dto.chargebackAmount && dto.chargebackAmount > entity.inputAmount)
      throw new BadRequestException('You can not refund more than the input amount');
  }

  async validateChargebackIban(iban: string, userData: UserData): Promise<boolean> {
    const bankAccount = await this.bankAccountService.getOrCreateBankAccountInternal(iban, userData);
    return (
      bankAccount &&
      (bankAccount.bic || iban.startsWith('CH') || iban.startsWith('LI')) &&
      IbanTools.validateIBAN(bankAccount.iban).valid
    );
  }

  async handlePermitInput(route: Swap | Sell, request: TransactionRequest, dto: ConfirmDto): Promise<CryptoInput> {
    const asset = await this.assetService.getAssetById(request.sourceId);

    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);

    if (dto.permit.executorAddress.toLowerCase() !== client.dfxAddress.toLowerCase())
      throw new BadRequestException('Invalid executor address');

    const contractValid = await client.isPermitContract(dto.permit.signatureTransferContract);
    if (!contractValid) throw new BadRequestException('Invalid signature transfer contract');

    const txId = await client.permitTransfer(
      dto.permit.address,
      dto.permit.signature,
      dto.permit.signatureTransferContract,
      asset,
      request.amount,
      dto.permit.permittedAmount,
      route.deposit.address,
      dto.permit.nonce,
      BigNumber.from(dto.permit.deadline),
    );

    const blockHeight = await client.getCurrentBlock();

    const [payIn] = await this.payInService.createPayIns([
      {
        senderAddresses: dto.permit.address,
        receiverAddress: BlockchainAddress.create(route.deposit.address, asset.blockchain),
        txId,
        txType: PayInType.PERMIT_TRANSFER,
        blockHeight,
        amount: request.amount,
        asset,
      },
    ]);

    return payIn;
  }
}
