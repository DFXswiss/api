import { Body, Controller, Get, Put, UseGuards, Post, Param, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { In } from 'typeorm';
import { BuyHistoryDto } from './dto/buy-history.dto';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyType } from './dto/buy-type.enum';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { Deposit } from 'src/mix/models/deposit/deposit.entity';
import { StakingDto } from 'src/mix/models/staking/dto/staking.dto';
import { Staking } from 'src/mix/models/staking/staking.entity';
import { StakingService } from 'src/mix/models/staking/staking.service';
import { BuyCryptoService } from '../process/services/buy-crypto.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';

@ApiTags('Buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly stakingService: StakingService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly bankService: BankService,
    private readonly paymentInfoService: PaymentInfoService,
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
    await this.paymentInfoService.buyCheck(dto);
    return this.buyService
      .createBuy(jwt.id, jwt.address, { ...dto, type: BuyType.WALLET }, true)
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
    const stakingRoutes = await this.stakingService
      .getStakingRepo()
      .find({ deposit: { id: In(buys.map((b) => b.deposit?.id)) } });
    return Promise.all(buys.map((b) => this.toDto(userId, b, stakingRoutes)));
  }

  private async toDto(userId: number, buy: Buy, stakingRoutes?: Staking[]): Promise<BuyDto> {
    const fee = await this.userService.getUserBuyFee(userId, buy.asset);
    return {
      type: buy.deposit != null ? BuyType.STAKING : BuyType.WALLET,
      ...buy,
      asset: AssetDtoMapper.entityToDto(buy.asset),
      staking: await this.getStaking(userId, buy.deposit, stakingRoutes),
      ...fee,
      minDeposits: Config.transaction.minVolume.getMany(buy.asset),
    };
  }

  private async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const bankInfo = await this.getBankInfo(buy, dto);

    return {
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant && buy.bankAccount.sctInst,
      remittanceInfo: buy.bankUsage,
      ...(await this.userService.getUserBuyFee(userId, buy.asset)),
      minDeposit: Config.transaction.minVolume.get(buy.asset, dto.currency.name),
    };
  }

  // --- HELPER-METHODS --- //
  private async getStaking(
    userId: number,
    deposit?: Deposit,
    stakingRoutes?: Staking[],
  ): Promise<StakingDto | undefined> {
    if (deposit == null) return undefined;

    return this.stakingService.toDto(
      userId,
      stakingRoutes
        ? stakingRoutes.find((s) => s.deposit.id === deposit.id)
        : await this.stakingService.getStakingRepo().findOne({ where: { deposit: deposit.id } }),
    );
  }

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
