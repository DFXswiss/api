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
import { AdminGuard } from 'src/auth/admin.guard';
import { Fiat } from './fiat.entity';
import { FiatService } from './fiat.service';

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get()
  async getFiatRoute(): Promise<any> {
    return this.fiatService.findFiatByAddress();
  }

  @Get('key')
  async getFiatByKey(@Param() key: string): Promise<any> {
    return this.fiatService.findFiatByKey(key);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createFiatRoute(@Body() fiat: Fiat, @Request() req) {
    if (this.fiatService.findFiatByAddress() != null) return 'Already exist';
    return this.fiatService.createFiat(fiat);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateFiatRoute(@Body() fiat: Fiat, @Request() req) {
    if (this.fiatService.findFiatByAddress() == null) return 'Not exist';
    return this.fiatService.updateFiat(fiat);
  }
}
