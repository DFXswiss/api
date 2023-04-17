import { Body, Controller, Get, Put, UseGuards, Post, Param, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyHistoryDto } from './dto/buy-history.dto';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

@ApiTags('Buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly bankService: BankService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createBuy(@GetJwt() jwt: JwtPayload, @Body() dto: CreateBuyDto): Promise<BuyDto> {
    dto = await this.paymentInfoService.buyCheck(jwt, dto);
    return this.buyService.createBuy(jwt.id, jwt.address, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    dto = await this.paymentInfoService.buyCheck(jwt, dto);
    return this.buyService
      .createBuy(jwt.id, jwt.address, dto, true)
      .then((buy) => this.toPaymentInfoDto(jwt.id, buy, dto));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.id, +id, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getBuyRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyHistoryDto[]> {
    return this.buyCryptoService.getBuyHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    return Promise.all(buys.map((b) => this.toDto(userId, b)));
  }

  private async toDto(userId: number, buy: Buy): Promise<BuyDto> {
    const fee = await this.userService.getUserBuyFee(userId, buy.asset);
    const { minFee, minDeposit } = this.transactionHelper.getDefaultSpecs(
      'Fiat',
      undefined,
      buy.asset.blockchain,
      buy.asset.dexName,
    );

    return {
      id: buy.id,
      active: buy.active,
      volume: buy.volume,
      annualVolume: buy.annualVolume,
      bankUsage: buy.bankUsage,
      asset: AssetDtoMapper.entityToDto(buy.asset),
      fee,
      minDeposits: [minDeposit],
      minFee,
    };
  }

  private async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const bankInfo = await this.getBankInfo(buy, dto);
    const fee = await this.userService.getUserBuyFee(userId, buy.asset);
    const { minVolume, minFee } = await this.transactionHelper.getSpecs(dto.currency, dto.asset);
    const estimatedAmount = await this.transactionHelper.getTargetEstimation(
      dto.amount,
      fee,
      minFee,
      dto.currency,
      dto.asset,
    );
    return {
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant && buy.bankAccount?.sctInst,
      remittanceInfo: buy.bankUsage,
      fee,
      minDeposit: { amount: minVolume, asset: dto.currency.name }, //TODO remove
      minVolume,
      minFee,
      estimatedAmount,
    };
  }

  // --- HELPER-METHODS --- //
  private async getBankInfo(buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BankInfoDto> {
    const bank = await this.bankService.getBank({
      amount: dto.amount,
      currency: dto.currency.name,
      bankAccount: buy.bankAccount,
      kycStatus: buy.user.userData.kycStatus,
    });

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return { ...Config.bank.dfxBankInfo, iban: bank.iban, bic: bank.bic, sepaInstant: bank.sctInst };
  }
}
