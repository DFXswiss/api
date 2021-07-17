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
import { RoleGuard } from 'src/guards/role.guard';
import { Fiat } from './fiat.entity';
import { FiatService } from './fiat.service';
import { CreateFiatDto } from './dto/create-fiat.dto';
import { GetFiatDto } from "./dto/get-fiat.dto";
import { UpdateFiatDto } from "./dto/update-fiat.dto";
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get(':key')
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFiat(@Param() fiat: any): Promise<any> {
    return this.fiatService.getFiat(fiat);
  }

  @Get()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllFiat(): Promise<any> {
    return this.fiatService.getAllFiat();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createFiat(@Body() createFiatDto: CreateFiatDto): Promise<any> {
    return this.fiatService.createFiat(createFiatDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateFiat(@Body() fiat:UpdateFiatDto) {
    return this.fiatService.updateFiat(fiat);
  }
}
