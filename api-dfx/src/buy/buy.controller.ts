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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserGuard } from 'src/auth/user.guard';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  @Get()
  @UseGuards(UserGuard)
  async getBuyRoute(): Promise<any> {
    return this.buyService.findBuyByAddress();
  }

  @Post()
  @UseGuards(UserGuard)
  async createBuyRoute(@Body() buy: Buy, @Request() req) {
    if (this.buyService.findBuyByAddress() != null) return 'Already exist';
    return this.buyService.createBuy(buy);
  }

  @Put()
  @UseGuards(UserGuard)
  async updateBuyRoute(@Body() buy: Buy, @Request() req) {
    if (this.buyService.findBuyByAddress() == null) return 'Not exist';
    return this.buyService.updateBuy(buy);
  }
}
