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
import { UserGuard } from 'src/guards/user.guard';
import { Sell } from './sell.entity';
import { SellService } from './sell.service';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Get()
  @UseGuards(UserGuard)
  async getSellRoute(): Promise<any> {
    return this.sellService.findSellByAddress();
  }

  @Post()
  @UseGuards(UserGuard)
  async createSellRoute(@Body() buy: Sell, @Request() req) {
    if (this.sellService.findSellByAddress() != null) return 'Already exist';
    return this.sellService.createSell(buy);
  }

  @Put()
  @UseGuards(UserGuard)
  async updateSellRoute(@Body() buy: Sell, @Request() req) {
    if (this.sellService.findSellByAddress() == null) return 'Not exist';
    return this.sellService.updateSell(buy);
  }
}
