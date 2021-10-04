import { Body, Controller, Get, Param, Put, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'Buy ID',
    schema: { type: 'integer' },
  })
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: number): Promise<Buy> {
    return this.buyService.getBuy(id, jwt.id);
  }

  @Get()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuyRoute(@GetJwt() jwt: JwtPayload): Promise<Buy[]> {
    return this.buyService.getAllBuy(jwt.id);
  }

  @Post()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createBuy(@GetJwt() jwt: JwtPayload, @Body() createBuyDto: CreateBuyDto): Promise<Buy> {
    return this.buyService.createBuy(jwt.id, createBuyDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Body() updateBuyDto: UpdateBuyDto): Promise<Buy> {
    return this.buyService.updateBuy(jwt.id, updateBuyDto);
  }
}
