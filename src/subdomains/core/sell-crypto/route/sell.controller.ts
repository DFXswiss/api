import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionDto, TransactionType } from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { TransactionDtoMapper } from '../../history/mappers/transaction-dto.mapper';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { ConfirmDto } from './dto/confirm.dto';
import { CreateSellDto } from './dto/create-sell.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { GetSellQuoteDto } from './dto/get-sell-quote.dto';
import { InvoiceDto } from './dto/invoice.dto';
import { SellHistoryDto } from './dto/sell-history.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { SellQuoteDto } from './dto/sell-quote.dto';
import { SellDto } from './dto/sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { Sell } from './sell.entity';
import { SellService } from './sell.service';

@ApiTags('Sell')
@Controller('sell')
export class SellController {
  constructor(
    private readonly sellService: SellService,
    private readonly userService: UserService,
    private readonly buyFiatService: BuyFiatService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly transactionHelper: TransactionHelper,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly assetService: AssetService,
    private readonly transactionService: TransactionService,
    private readonly fiatService: FiatService,
    private readonly swissQrService: SwissQRService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<SellDto[]> {
    return this.sellService.getUserSells(jwt.user).then((l) => this.toDtoList(l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiOkResponse({ type: SellDto })
  async getSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellDto> {
    return this.sellService.get(jwt.user, +id).then((l) => this.toDto(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  async createSell(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSellDto): Promise<SellDto> {
    dto.currency ??= dto.fiat;

    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return this.sellService.createSell(jwt.user, dto).then((s) => this.toDto(s));
  }

  @Put('/quote')
  @ApiOkResponse({ type: SellQuoteDto })
  async getSellQuote(@Body() dto: GetSellQuoteDto): Promise<SellQuoteDto> {
    const {
      amount: sourceAmount,
      asset,
      currency,
      targetAmount,
      specialCode,
    } = await this.paymentInfoService.sellCheck(dto);

    const {
      rate,
      exchangeRate,
      estimatedAmount,
      sourceAmount: amount,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
      feeSource,
      feeTarget,
      priceSteps,
    } = await this.transactionHelper.getTxDetails(
      sourceAmount,
      targetAmount,
      asset,
      currency,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      true,
      undefined,
      dto.wallet,
      specialCode ? [specialCode] : [],
    );

    return {
      feeAmount: feeSource.total,
      rate,
      exchangeRate,
      estimatedAmount,
      amount,
      minVolume,
      minVolumeTarget,
      fees: feeSource,
      feesTarget: feeTarget,
      maxVolume,
      maxVolumeTarget,
      priceSteps,
      isValid,
      error,
    };
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserActiveGuard)
  @ApiOkResponse({ type: SellPaymentInfoDto })
  async createSellWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetSellPaymentInfoDto,
  ): Promise<SellPaymentInfoDto> {
    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return this.sellService.createSellPaymentInfo(jwt.user, dto);
  }

  @Put('/paymentInfos/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserActiveGuard)
  @ApiOkResponse({ type: TransactionDto })
  async confirmSell(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmDto,
  ): Promise<TransactionDto> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    return this.sellService.confirmSell(request, dto).then((tx) => TransactionDtoMapper.mapBuyFiatTransaction(tx));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  async updateSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSellDto): Promise<SellDto> {
    return this.sellService.updateSell(jwt.user, +id, dto).then((s) => this.toDto(s));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getSellRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellHistoryDto[]> {
    return this.buyFiatService.getSellHistory(jwt.user, +id);
  }

  @Put('/transaction/:id/invoice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserActiveGuard)
  @ApiOkResponse({ type: InvoiceDto })
  async generateInvoiceFromTransaction(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<InvoiceDto> {
    const transaction = await this.transactionService.getTransactionById(+id, {
      user: { userData: true },
      buyFiat: { outputAsset: true, sell: true, cryptoInput: { asset: true } },
    });

    if (!transaction) throw new BadRequestException('Transaction not found');
    if (!transaction.buyFiat || (transaction.type && transaction.type !== 'BuyFiat'))
      throw new BadRequestException('Transaction is not a sell transaction');
    if (!transaction.user.userData.isDataComplete) throw new BadRequestException('User data is not complete');

    const sell = transaction.buyFiat.sell;
    const currency = transaction.buyFiat.outputAsset;
    const bankInfo = await this.sellService.getBankInfo({
      amount: transaction.buyFiat.outputAmount,
      currency: currency.name,
      paymentMethod: transaction.buyFiat.paymentMethodOut as CryptoPaymentMethod,
      userData: transaction.user.userData,
    });

    if (currency.name !== 'CHF' && currency.name !== 'EUR') {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }
    if (!sell) throw new BadRequestException('Sell route not found');

    return {
      invoicePdf: await this.swissQrService.createInvoiceFromTx(
        transaction,
        bankInfo,
        currency.name,
        TransactionType.SELL,
      ),
    };
  }

  // --- DTO --- //
  private async toDtoList(sell: Sell[]): Promise<SellDto[]> {
    return Promise.all(sell.map((s) => this.toDto(s)));
  }

  private async toDto(sell: Sell): Promise<SellDto> {
    const { minDeposit } = this.transactionHelper.getDefaultSpecs(
      sell.deposit.blockchainList[0],
      undefined,
      'Fiat',
      sell.fiat.name,
    );

    const defaultBlockchain = CryptoService.getDefaultBlockchainBasedOn(sell.user.address);
    const fee = await this.userService.getUserFee(
      sell.user.id,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      undefined,
      IbanBankName.MAERKI,
      await this.assetService.getNativeAsset(defaultBlockchain),
      sell.fiat,
    );

    return {
      id: sell.id,
      iban: sell.iban,
      active: sell.active,
      volume: sell.volume,
      annualVolume: sell.annualVolume,
      fiat: FiatDtoMapper.toDto(sell.fiat),
      currency: FiatDtoMapper.toDto(sell.fiat),
      deposit: sell.active ? DepositDtoMapper.entityToDto(sell.deposit) : undefined,
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      blockchain: sell.deposit.blockchainList[0],
      minFee: { amount: fee.network, asset: 'CHF' },
      minDeposits: [minDeposit],
    };
  }
}
