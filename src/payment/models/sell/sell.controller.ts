import { Body, Controller, Get, Put, UseGuards, Post } from '@nestjs/common';
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

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

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

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSell(@GetJwt() jwt: JwtPayload, @Body() updateSellDto: UpdateSellDto): Promise<SellDto> {
    return this.sellService.updateSell(jwt.id, updateSellDto).then((s) => this.toDto(jwt.id, s));
  }

  private async toDtoList(userId: number, sell: Sell[]): Promise<SellDto[]> {
    const sellDepositsInUse = await this.sellService.getUserSellDepositsInUse(userId);
    return Promise.all(sell.map((s) => this.toDto(userId, s, sellDepositsInUse)));
  }

  private async toDto(userId: number, sell: Sell, sellDepositsInUse?: number[]): Promise<SellDto> {
    sellDepositsInUse ??= await this.sellService.getUserSellDepositsInUse(userId);
    return {
      ...sell,
      fee: 2.9,
      isInUse: sellDepositsInUse.includes(sell.deposit.id),
    };
  }
}
