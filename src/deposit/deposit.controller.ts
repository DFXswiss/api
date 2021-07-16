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
import { AdminGuard } from 'src/guards/admin.guard';
import { Deposit } from './deposit.entity';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from 'src/deposit/dto/create-deposit.dto';
import { GetDepositDto } from "./dto/get-deposit.dto";
import { UpdateDepositDto } from "./dto/update-deposit.dto";

@ApiTags('deposit')
@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Get(':key')
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  async getDeposit(@Param() deposit: any): Promise<any> {
    return this.depositService.getDeposit(deposit);
  }

  @Get()
  @UseGuards(AdminGuard)
  async getAllDeposit(): Promise<any> {
    return this.depositService.getAllDeposit();
  }

  @Get('next')
  @UseGuards(AdminGuard)
  async getNextDeposit(): Promise<any> {
    return this.depositService.getNextDeposit();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AdminGuard)
  createDeposit(@Body() createDepositDto: CreateDepositDto): Promise<any> {
    return this.depositService.createDeposit(createDepositDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  async updateDepositRoute(@Body() deposit: UpdateDepositDto): Promise<any> {
    return this.depositService.updateDeposit(deposit);
  }
}
