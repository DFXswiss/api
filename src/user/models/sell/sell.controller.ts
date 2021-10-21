import { Body, Controller, Get, Param, Put, UseGuards, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Sell } from './sell.entity';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<Sell> {
    return this.sellService.getSell(+id, jwt.id);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<Sell[]> {
    return this.sellService.getAllSell(jwt.id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(@GetJwt() jwt: JwtPayload, @Body() createSellDto: CreateSellDto): Promise<Sell> {
    return this.sellService.createSell(jwt.id, createSellDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSell(@GetJwt() jwt: JwtPayload, @Body() updateSellDto: UpdateSellDto): Promise<Sell> {
    return this.sellService.updateSell(jwt.id, updateSellDto);
  }
}
