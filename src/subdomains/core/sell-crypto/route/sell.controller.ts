import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { BuyFiatService } from '../process/buy-fiat.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { SellHistoryDto } from './dto/sell-history.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
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
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<SellDto[]> {
    return this.sellService.getUserSells(jwt.id).then((l) => this.toDtoList(l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: SellDto })
  async getSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellDto> {
    return this.sellService.get(jwt.id, +id).then((l) => this.toDto(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createSell(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSellDto): Promise<SellDto> {
    dto.currency ??= dto.fiat;

    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return this.sellService.createSell(jwt.id, dto).then((s) => this.toDto(s));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: SellPaymentInfoDto })
  async createSellWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetSellPaymentInfoDto,
  ): Promise<SellPaymentInfoDto> {
    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return this.sellService
      .createSell(jwt.id, { ...dto, blockchain: dto.asset.blockchain }, true)
      .then((sell) => this.toPaymentInfoDto(jwt.id, sell, dto));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSellDto): Promise<SellDto> {
    return this.sellService.updateSell(jwt.id, +id, dto).then((s) => this.toDto(s));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getSellRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellHistoryDto[]> {
    return this.buyFiatService.getSellHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(sell: Sell[]): Promise<SellDto[]> {
    return Promise.all(sell.map((s) => this.toDto(s)));
  }

  private async toDto(sell: Sell): Promise<SellDto> {
    const { minFee, minDeposit } = this.transactionHelper.getDefaultSpecs(
      sell.deposit.blockchain,
      undefined,
      'Fiat',
      sell.fiat.name,
    );
    return {
      id: sell.id,
      iban: sell.iban,
      active: sell.active,
      volume: sell.volume,
      annualVolume: sell.annualVolume,
      fiat: FiatDtoMapper.entityToDto(sell.fiat),
      currency: FiatDtoMapper.entityToDto(sell.fiat),
      deposit: DepositDtoMapper.entityToDto(sell.deposit),
      fee: undefined,
      blockchain: sell.deposit.blockchain,
      minFee,
      minDeposits: [minDeposit],
    };
  }

  private async toPaymentInfoDto(userId: number, sell: Sell, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
    const fee = await this.userService.getUserSellFee(userId, dto.asset);
    const { minVolume, minFee } = await this.transactionHelper.getSpecs(dto.asset, dto.currency);
    const { amount: estimatedAmount } = await this.transactionHelper.getTargetEstimation(
      dto.amount,
      fee,
      minFee,
      dto.asset,
      dto.currency,
    );
    return {
      routeId: sell.id,
      fee: Util.round(fee * 100, Config.defaultPercentageDecimal),
      depositAddress: sell.deposit.address,
      blockchain: sell.deposit.blockchain,
      minDeposit: { amount: minVolume, asset: dto.asset.dexName },
      minVolume,
      minFee,
      estimatedAmount,
    };
  }
}
