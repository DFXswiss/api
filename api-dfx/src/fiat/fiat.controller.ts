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
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserGuard } from 'src/auth/user.guard';
import { Fiat } from './fiat.entity';
import { FiatService } from './fiat.service';

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get()
  @UseGuards(UserGuard)
  async getFiatRoute(): Promise<any> {
    return this.fiatService.findFiatByAddress();
  }

  @Get('key')
  @UseGuards(UserGuard)
  async getFiatByKey(@Query() key: string): Promise<any> {
    return this.fiatService.findFiatByKey(key);
  }

  @Post()
  @UseGuards(UserGuard)
  async createFiatRoute(@Body() fiat: Fiat, @Request() req) {
    if (this.fiatService.findFiatByAddress() != null) return 'Already exist';
    return this.fiatService.createFiat(fiat);
  }

  @Put()
  @UseGuards(UserGuard)
  async updateFiatRoute(@Body() fiat: Fiat, @Request() req) {
    if (this.fiatService.findFiatByAddress() == null) return 'Not exist';
    return this.fiatService.updateFiat(fiat);
  }
}
