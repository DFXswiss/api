import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
import { UserService } from 'src/user/models/user/user.service';
import { BuyFiatService } from '../buy-fiat/buy-fiat.service';
import { BuyFiatHistoryDto } from '../buy-fiat/dto/buy-fiat-history.dto';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/util';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(
    private readonly sellService: SellService,
    private readonly userService: UserService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<SellDto[]> {
    return this.sellService.getUserSells(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(@GetJwt() jwt: JwtPayload, @Body() createSellDto: CreateSellDto): Promise<SellDto> {
    return this.sellService.createSell(jwt.id, createSellDto).then((s) => this.toDto(jwt.id, s));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSell(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateSellDto: UpdateSellDto,
  ): Promise<SellDto> {
    return this.sellService.updateSell(jwt.id, +id, updateSellDto).then((s) => this.toDto(jwt.id, s));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getSellRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyFiatHistoryDto[]> {
    return this.buyFiatService.getHistory(jwt.id, +id);
  }

  private async toDtoList(userId: number, sell: Sell[]): Promise<SellDto[]> {
    const sellDepositsInUse = await this.sellService.getUserSellDepositsInUse(userId);
    const fee = await this.userService.getUserSellFee(userId);

    return Promise.all(sell.map((s) => this.toDto(userId, s, sellDepositsInUse, fee)));
  }

  private async toDto(userId: number, sell: Sell, sellDepositsInUse?: number[], fee?: number): Promise<SellDto> {
    sellDepositsInUse ??= await this.sellService.getUserSellDepositsInUse(userId);
    fee ??= await this.userService.getUserSellFee(userId);

    return {
      ...sell,
      fee: fee,
      isInUse: sellDepositsInUse.includes(sell.deposit.id),
      minDeposits: Util.transformToMinDeposit(Config.blockchain.default.minDeposit.DeFiChain),
    };
  }
}
