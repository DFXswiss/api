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
import { RoleGuard } from 'src/guards/role.guard';
import { Sell } from './sell.entity';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UserRole } from 'src/user/user.entity';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getSellRoute(): Promise<any> {
    return this.sellService.findSellByAddress();
  }

  
  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(@Body() createSellDto: CreateSellDto): Promise<void> {
    return this.sellService.createSell(createSellDto);
  }
  
  // @Post()
  // @UseGuards(UserGuard)
  // async createSellRoute(@Body() buy: Sell, @Request() req) {
  //   if (this.sellService.findSellByAddress() != null) return 'Already exist';
  //   return this.sellService.createSell(buy);
  // }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSellRoute(@Body() buy: Sell, @Request() req) {
    if (this.sellService.findSellByAddress() == null) return 'Not exist';
    return this.sellService.updateSell(buy);
  }
}
