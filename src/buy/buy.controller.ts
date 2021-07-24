import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/guards/role.guard';
import { User, UserRole } from 'src/user/user.entity';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  @Get(':key')
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRoute(@GetUser() user: User, @Param() key: any): Promise<any> {
    return this.buyService.getBuy(key, user.address);
  }

  @Get()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuyRoute(@GetUser() user: User): Promise<any> {
    return this.buyService.getAllBuy(user.address);
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createBuy(
    @GetUser() user: User,
    @Body() createBuyDto: CreateBuyDto,
  ): Promise<any> {
    createBuyDto.address = user.address;
    return this.buyService.createBuy(createBuyDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(
    @GetUser() user: User,
    @Body() updateBuyDto: UpdateBuyDto,
  ): Promise<any> {
    updateBuyDto.address = user.address;
    return this.buyService.updateBuy(updateBuyDto);
  }
}
