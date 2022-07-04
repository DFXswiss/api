import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/user/models/user/user.service';
import { CryptoService } from './crypto.service';
import { CryptoDto } from './dto/crypto.dto';
import { CryptoRoute } from './crypto-route.entity';
import { CreateCryptoDto } from './dto/create-crypto.dto';
import { UpdateCryptoDto } from './dto/update-crypto.dto';
import { BuyType } from '../buy/dto/buy-type.enum';

@ApiTags('crypto')
@Controller('crypto')
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService, private readonly userService: UserService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllCrypto(@GetJwt() jwt: JwtPayload): Promise<CryptoDto[]> {
    return this.cryptoService.getUserCryptos(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createCrypto(@GetJwt() jwt: JwtPayload, @Body() createCryptoDto: CreateCryptoDto): Promise<CryptoDto> {
    return this.cryptoService.createCrypto(jwt.id, createCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateCryptoRoute(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateCryptoDto: UpdateCryptoDto,
  ): Promise<CryptoDto> {
    return this.cryptoService.updateCrypto(jwt.id, +id, updateCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: CryptoRoute[]): Promise<CryptoDto[]> {
    const fees = await this.getFees(userId);

    return Promise.all(cryptos.map((b) => this.toDto(userId, b, fees)));
  }

  private async toDto(userId: number, crypto: CryptoRoute, fees?: { fee: number; refBonus: number }): Promise<CryptoDto> {
    fees ??= await this.getFees(userId);

    return {
      buyType: crypto.deposit != null ? BuyType.STAKING : BuyType.WALLET,
      ...crypto,
      ...fees,
    };
  }

  async getFees(userId: number): Promise<{ fee: number; refBonus: number }> {
    const { annualVolume } = await this.cryptoService.getUserVolume(userId);
    return this.userService.getUserCryptoFee(userId, annualVolume);
  }
}
