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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Fiat } from './fiat.entity';
import { FiatService } from './fiat.service';
import { CreateFiatDto } from './dto/create-fiat.dto';

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
  @UsePipes(ValidationPipe)
  createFiat(@Body() createFiatDto: CreateFiatDto): Promise<void> {
    return this.fiatService.createFiat(createFiatDto);
  }

  // @Post()
  // @UseGuards(AdminGuard)
  // async createFiatRoute(@Body() fiat: Fiat, @Request() req) {
  //   if (this.fiatService.findFiatByAddress() != null) return 'Already exist';
  //   return this.fiatService.createFiat(fiat);
  // }

  @Put()
  @UseGuards(AdminGuard)
  async updateFiatRoute(@Body() fiat: Fiat, @Request() req) {
    if (this.fiatService.findFiatByAddress() == null) return 'Not exist';
    return this.fiatService.updateFiat(fiat);
  }
}
