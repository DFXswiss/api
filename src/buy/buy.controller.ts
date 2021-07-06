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
import { ApiTags } from '@nestjs/swagger';
import { UserGuard } from 'src/guards/user.guard';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { CreateBuyDto } from './dto/create-buy.dto';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  @Get()
  @UseGuards(UserGuard)
  async getBuyRoute(): Promise<any> {
    return this.buyService.getBuy();
  }

  @Post()
  @UsePipes(ValidationPipe)
  createBuy(@Body() createBuyDto: CreateBuyDto): Promise<void> {
    return this.buyService.createBuy(createBuyDto);
  }

  // @Post()
  // @UseGuards(UserGuard)
  // async createBuyRoute(@Body() buy: Buy, @Request() req) {
  //   if (this.buyService.getBuy() != null) return 'Already exist';
  //   return this.buyService.createBuy(buy);
  // }

  @Put()
  @UseGuards(UserGuard)
  async updateBuyRoute(@Body() buy: Buy, @Request() req) {
    if (this.buyService.getBuy() == null) return 'Not exist';
    return this.buyService.updateBuy(buy);
  }
}
