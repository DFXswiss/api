import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Post,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: number): Promise<Buy> {
    const buy = await this.buyService.getBuy(id);

    if (!buy) throw new NotFoundException('No matching buy route for ID found');
    if (buy.id != jwt.id) throw new ForbiddenException('Not your buy route');

    return buy;
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuyRoute(@GetJwt() jwt: JwtPayload): Promise<Buy[]> {
    return this.buyService.getUserBuys(jwt.id);
  }

  @Post()
  @ApiBearerAuth()
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
