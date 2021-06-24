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
import { UserGuard } from 'src/auth/user.guard';
import { Deposit } from './deposit.entity';
import { DepositService } from './deposit.service';

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
  async getFiatByKey(@Query() key: string): Promise<any> {
    return this.depositService.findDepositByKey(key);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createDepositRoute(@Body() deposit: Deposit, @Request() req) {
    if (this.depositService.findDepositByAddress() != null) return 'Already exist';
    return this.depositService.createDeposit(deposit);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateDepositRoute(@Body() deposit: Deposit, @Request() req) {
    if (this.depositService.findDepositByAddress() == null) return 'Not exist';
    return this.depositService.updateDeposit(deposit);
  }
}
