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
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { CreateBuyDto } from './dto/create-buy.dto';
import { GetBuyDto } from './dto/get-buy.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  @Get()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRoute(@Body() getBuyDto: GetBuyDto): Promise<any> {
    return this.buyService.getBuy(getBuyDto);
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createBuy(@Body() createBuyDto: CreateBuyDto): Promise<void> {
    return this.buyService.createBuy(createBuyDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(@Body() buy: Buy, @Request() req) {
    //if (this.buyService.getBuy() == null) return 'Not exist';
    return this.buyService.updateBuy(buy);
  }
}
