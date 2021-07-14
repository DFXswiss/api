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
import { GetFiatDto } from "./dto/get-fiat.dto";
import { UpdateFiatDto } from "./dto/update-fiat.dto";

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get()
  @UsePipes(ValidationPipe)
  async getFiat(@Body() fiat: GetFiatDto): Promise<any> {
    return this.fiatService.getFiat(fiat);
  }

  @Get('all')
  @UsePipes(ValidationPipe)
  async getAllFiat(): Promise<any> {
    return this.fiatService.getAllFiat();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AdminGuard)
  createFiat(@Body() createFiatDto: CreateFiatDto): Promise<any> {
    return this.fiatService.createFiat(createFiatDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  async updateFiat(@Body() fiat:UpdateFiatDto) {
    return this.fiatService.updateFiat(fiat);
  }
}
