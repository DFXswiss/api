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
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposit')
@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Get()
  @UseGuards(AdminGuard)
  async getDepositRoute(): Promise<any> {
    return this.depositService.findDepositByAddress();
  }

  @Get('key')
  @UseGuards(AdminGuard)
  async getFiatByKey(@Param() key: string): Promise<any> {
    return this.depositService.findDepositByKey(key);
  }

  @Post()
  @UsePipes(ValidationPipe)
  createDeposit(@Body() createDepositDto: CreateDepositDto): Promise<void> {
    return this.depositService.createDeposit(createDepositDto);
  }

  // @Post()
  // @UseGuards(AdminGuard)
  // async createDepositRoute(@Body() deposit: Deposit, @Request() req) {
  //   if (this.depositService.findDepositByAddress() != null) return 'Already exist';
  //   return this.depositService.createDeposit(deposit);
  // }

  @Put()
  @UseGuards(AdminGuard)
  async updateDepositRoute(@Body() deposit: Deposit, @Request() req) {
    if (this.depositService.findDepositByAddress() == null) return 'Not exist';
    return this.depositService.updateDeposit(deposit);
  }
}
