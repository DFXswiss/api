import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { UserService } from 'src/user/models/user/user.service';
import { In } from 'typeorm';
import { BuyCryptoHistoryDto } from '../buy-crypto/dto/buy-crypto-history.dto';
import { BuyCryptoService } from '../buy-crypto/services/buy-crypto.service';
import { Deposit } from '../deposit/deposit.entity';
import { StakingDto } from '../staking/dto/staking.dto';
import { Staking } from '../staking/staking.entity';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyType } from './dto/buy-type.enum';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Bank, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
    private readonly buyCryptoService: BuyCryptoService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createBuy(@GetJwt() jwt: JwtPayload, @Body() createBuyDto: CreateBuyDto): Promise<BuyDto> {
    return this.buyService.createBuy(jwt.id, jwt.address, createBuyDto).then((b) => this.toDto(jwt.id, b));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiResponse({ status: 200, type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() createBuyDto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    return this.buyService
      .getBuyPaymentInfos(jwt.id, jwt.address, createBuyDto)
      .then((b) => this.toPaymentInfoDto(jwt.id, b.buy, b.bank));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateBuyDto: UpdateBuyDto,
  ): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.id, +id, updateBuyDto).then((b) => this.toDto(jwt.id, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyCryptoHistoryDto[]> {
    return this.buyCryptoService.getHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    const stakingRoutes = await this.stakingRepo.find({ deposit: { id: In(buys.map((b) => b.deposit?.id)) } });
    return Promise.all(buys.map((b) => this.toDto(userId, b, stakingRoutes)));
  }

  private async toPaymentInfoDto(userId: number, buy: Buy, bankName: Bank): Promise<BuyPaymentInfoDto> {
    return {
      ...Config.bank.dfxBankInfo,
      ...(bankName === Bank.MAERKI ? Config.bank.maerki.accounts[0] : Config.bank.olkypay.accounts[0]),
      bankUsage: buy.bankUsage,
      ...(await this.getFees(userId)),
      minDeposits: Util.transformToMinDeposit(Config.node.minDeposit.Fiat),
    };
  }

  private async toDto(userId: number, buy: Buy, stakingRoutes?: Staking[]): Promise<BuyDto> {
    return {
      type: buy.deposit != null ? BuyType.STAKING : BuyType.WALLET,
      ...buy,
      staking: await this.getStaking(userId, buy.deposit, stakingRoutes),
      ...(await this.getFees(userId)),
      minDeposits: Util.transformToMinDeposit(Config.node.minDeposit.Fiat),
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
        : await this.stakingRepo.findOne({ where: { deposit: deposit.id } }),
    );
  }

  async getFees(userId: number): Promise<{ fee: number; refBonus: number }> {
    const { annualVolume } = await this.buyService.getUserVolume(userId);
    return this.userService.getUserBuyFee(userId, annualVolume);
  }
}
