import { Body, Controller, Get, Put, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/user/models/user/user.service';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService, private readonly userService: UserService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createBuy(@GetJwt() jwt: JwtPayload, @Body() createBuyDto: CreateBuyDto): Promise<BuyDto> {
    return this.buyService.createBuy(jwt.id, jwt.address, createBuyDto).then((b) => this.toDto(jwt.id, b));
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Body() updateBuyDto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.id, updateBuyDto).then((b) => this.toDto(jwt.id, b));
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    const fees = await this.getFees(userId);
    return buys.map((b) => ({ ...b, ...fees }));
  }

  private async toDto(userId: number, buy: Buy): Promise<BuyDto> {
    const fees = await this.getFees(userId);
    return {
      ...buy,
      ...fees,
    };
  }

  async getFees(userId: number): Promise<{ fee: number; refBonus: number }> {
    const { annualVolume } = await this.buyService.getUserVolume(userId);
    const baseFee = annualVolume < 5000 ? 2.9 : annualVolume < 50000 ? 2.65 : annualVolume < 100000 ? 2.4 : 1.4;

    const refUser = await this.userService.getRefUser(userId);
    const refBonus = annualVolume < 100000 ? 1 - (refUser?.refFeePercent ?? 1) : 0;

    return {
      fee: baseFee - refBonus,
      refBonus,
    };
  }
}
