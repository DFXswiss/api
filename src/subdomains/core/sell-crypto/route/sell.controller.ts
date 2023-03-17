import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { SellDto } from './dto/sell.dto';
import { Sell } from './sell.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyFiatService } from '../process/buy-fiat.service';
import { SellHistoryDto } from './dto/sell-history.dto';
import { Config } from 'src/config/config';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';

@ApiTags('Sell')
@Controller('sell')
export class SellController {
  constructor(
    private readonly sellService: SellService,
    private readonly userService: UserService,
    private readonly buyFiatService: BuyFiatService,
    private readonly paymentInfoService: PaymentInfoService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<SellDto[]> {
    return this.sellService.getUserSells(jwt.id).then((l) => this.toDtoList(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createSell(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSellDto): Promise<SellDto> {
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
    dto = await this.paymentInfoService.sellCheck(dto);
    return this.sellService
      .createSell(jwt.id, { ...dto, fiat: dto.currency }, true)
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
    return {
      ...sell,
      fiat: FiatDtoMapper.entityToDto(sell.fiat),
      deposit: DepositDtoMapper.entityToDto(sell.deposit),
      fee: undefined,
      blockchain: sell.deposit.blockchain,
      minDeposits: [this.getMinDeposit(sell)],
    };
  }

  private async toPaymentInfoDto(userId: number, sell: Sell, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
    return {
      ...(await this.getFee(userId, dto.asset)),
      depositAddress: sell.deposit.address,
      blockchain: sell.deposit.blockchain,
      minDeposit: this.getMinDeposit(sell),
    };
  }

  // --- HELPER-METHODS --- //
  async getFee(userId: number, asset: Asset): Promise<{ fee: number }> {
    return this.userService.getUserSellFee(userId, asset);
  }

  private getMinDeposit(sell: Sell): MinDeposit {
    // TODO: refactor transaction volume calculation (DEV-1195)
    if (sell.deposit.blockchain === Blockchain.BITCOIN && sell.fiat.name !== 'USD')
      return { amount: Config.blockchain.default.minDeposit.Bitcoin.BTC, asset: 'BTC' };

    return Config.transaction.minVolume.get(sell.fiat, sell.fiat.name);
  }
}
