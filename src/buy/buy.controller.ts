import { Body, Controller, Get, Param, Put, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { User, UserRole } from 'src/user/user.entity';
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
  async getBuyRoute(@GetUser() user: User, @Param('id') id: number): Promise<Buy> {
    return this.buyService.getBuy(id, user.id);
  }

  @Get()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuyRoute(@GetUser() user: User): Promise<Buy[]> {
    return this.buyService.getAllBuy(user.id);
  }

  @Post()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createBuy(@GetUser() user: User, @Body() createBuyDto: CreateBuyDto): Promise<Buy> {
    createBuyDto.user = user;
    return this.buyService.createBuy(createBuyDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(@GetUser() user: User, @Body() updateBuyDto: UpdateBuyDto): Promise<Buy> {
    updateBuyDto.address = user.address;
    return this.buyService.updateBuy(updateBuyDto);
  }
}
