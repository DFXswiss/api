import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { BigNumber } from 'ethers/lib/ethers';
import * as IbanTools from 'ibantools';
import { Eip7702RelayerService } from 'src/integration/blockchain/shared/evm/eip7702/eip7702-relayer.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { CryptoInput, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { SpecialExternalAccountType } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { CheckStatus } from '../aml/enums/check-status.enum';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { Swap } from '../buy-crypto/routes/swap/swap.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import { GaslessDto, PermitDto } from '../sell-crypto/route/dto/confirm.dto';
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
    private readonly txValidationService: TxValidationService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    private readonly bankAccountService: BankAccountService,
    private readonly specialExternalAccountService: SpecialExternalAccountService,
    private readonly eip7702RelayerService: Eip7702RelayerService,
  ) {}

  static validateRefund(entity: BuyCrypto | BuyFiat | BankTxReturn, dto: RefundValidation): void {
    if (!(entity instanceof BankTxReturn) && entity.cryptoInput) {
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
      (entity instanceof BuyCrypto && (entity.chargebackCryptoTxId || entity.chargebackBankTx)) ||
      (entity instanceof BankTxReturn && (entity.chargebackOutput || entity.chargebackBankTx))
    )
      throw new BadRequestException('Transaction is already returned');

    if (entity instanceof BankTxReturn) {
      if (dto.chargebackAmount && dto.chargebackAmount > entity.bankTx.amount)
        throw new BadRequestException('You can not refund more than the input amount');
      return;
    }

    if (![CheckStatus.FAIL, CheckStatus.PENDING].includes(entity.amlCheck) || entity.outputAmount)
      throw new BadRequestException('Only failed or pending transactions are refundable');
    if (
      dto.chargebackAmount &&
      dto.chargebackAmount > (entity instanceof BuyCrypto && entity.bankTx ? entity.bankTx.amount : entity.inputAmount)
    )
      throw new BadRequestException('You can not refund more than the input amount');
  }

  async validateChargebackIban(iban: string, validateIbanCountry: boolean): Promise<boolean> {
    const bankAccount = await this.bankAccountService.getOrCreateIbanBankAccountInternal(iban, validateIbanCountry);
    const blockedAccounts = await this.specialExternalAccountService.getBlacklist();
    const multiAccountIbans = await this.specialExternalAccountService.getMultiAccountIbans();

    if (multiAccountIbans.includes(iban)) throw new BadRequestException('MultiAccountIban not allowed');
    if (
      blockedAccounts.some(
        (b) =>
          [
            SpecialExternalAccountType.BANNED_IBAN,
            SpecialExternalAccountType.BANNED_IBAN_BUY,
            SpecialExternalAccountType.BANNED_IBAN_SELL,
            SpecialExternalAccountType.BANNED_IBAN_AML,
          ].includes(b.type) && b.value === iban,
      )
    )
      throw new BadRequestException('Iban not allowed');
    if (
      blockedAccounts.some(
        (b) =>
          [
            SpecialExternalAccountType.BANNED_BIC,
            SpecialExternalAccountType.BANNED_BIC_BUY,
            SpecialExternalAccountType.BANNED_BIC_SELL,
            SpecialExternalAccountType.BANNED_BIC_AML,
          ].includes(b.type) && b.value === bankAccount?.bic,
      )
    )
      throw new BadRequestException('BIC not allowed');

    return (
      bankAccount &&
      (bankAccount.bic || iban.startsWith('CH') || iban.startsWith('LI')) &&
      IbanTools.validateIBAN(bankAccount.iban).valid
    );
  }

  async handlePermitInput(route: Swap | Sell, request: TransactionRequest, dto: PermitDto): Promise<CryptoInput> {
    const asset = await this.assetService.getAssetById(request.sourceId);

    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);

    if (dto.executorAddress.toLowerCase() !== client.walletAddress.toLowerCase())
      throw new BadRequestException('Invalid executor address');

    const contractValid = await client.isPermitContract(dto.signatureTransferContract);
    if (!contractValid) throw new BadRequestException('Invalid signature transfer contract');

    const txId = await client.permitTransfer(
      dto.address,
      dto.signature,
      dto.signatureTransferContract,
      asset,
      request.amount,
      dto.permittedAmount,
      route.deposit.address,
      dto.nonce,
      BigNumber.from(dto.deadline),
    );

    const blockHeight = await client.getCurrentBlock();

    return this.payInService.createPayIn(
      dto.address,
      route.deposit.address,
      asset,
      txId,
      PayInType.PERMIT_TRANSFER,
      blockHeight,
      request.amount,
    );
  }

  async handleSignedTxInput(
    route: Swap | Sell,
    request: TransactionRequest,
    signedTxHex: string,
  ): Promise<CryptoInput> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const parsedTx = this.txValidationService.validateEvmTransaction(
      signedTxHex,
      route.deposit.address,
      request.amount,
      asset,
    );
    if (!parsedTx.isValid) throw new BadRequestException(parsedTx.error || 'Invalid transaction');

    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);

    const txResponse = await client.sendSignedTransaction(signedTxHex);
    if (txResponse.error) throw new BadRequestException(`Transaction broadcast failed: ${txResponse.error.message}`);

    const txId = txResponse.response.hash;
    const blockHeight = await client.getCurrentBlock();

    return this.payInService.createPayIn(
      parsedTx.sender,
      route.deposit.address,
      asset,
      txId,
      PayInType.SIGNED_TRANSFER,
      blockHeight,
      request.amount,
    );
  }

  async handleGaslessInput(route: Sell, request: TransactionRequest, dto: GaslessDto): Promise<CryptoInput> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const depositAddress = route.deposit.address;

    // Validate token address matches the asset
    if (dto.tokenAddress.toLowerCase() !== asset.chainId.toLowerCase()) {
      throw new BadRequestException('Token address does not match asset');
    }

    // Validate recipient matches the route deposit address
    if (dto.recipient.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new BadRequestException('Recipient does not match deposit address');
    }

    // Validate recipient is a DFX-controlled address
    if (!this.eip7702RelayerService.isRecipientAllowed(depositAddress)) {
      throw new BadRequestException('Deposit address not in allowed recipients');
    }

    // Validate deadline hasn't passed
    if (Math.floor(Date.now() / 1000) > dto.deadline) {
      throw new BadRequestException('Signature deadline has passed');
    }

    // Execute gasless transfer via EIP-7702 relayer
    const result = await this.eip7702RelayerService.executeGaslessTransfer({
      userAddress: dto.userAddress,
      tokenAddress: asset.chainId,
      amount: dto.amount,
      recipient: depositAddress,
      deadline: dto.deadline,
      signature: dto.signature,
    });

    if (!result.success) {
      throw new BadRequestException(`Gasless transfer failed: ${result.error}`);
    }

    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    const blockHeight = await client.getCurrentBlock();

    return this.payInService.createPayIn(
      dto.userAddress,
      depositAddress,
      asset,
      result.txHash,
      PayInType.GASLESS_TRANSFER,
      blockHeight,
      request.amount,
    );
  }
}
