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
import { Deposit } from './deposit.entity';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from 'src/deposit/dto/create-deposit.dto';
import { UpdateDepositDto } from './dto/update-deposit.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('deposit')
@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Get(':key')
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UsePipes(ValidationPipe)
  async getDeposit(@Param() deposit: any): Promise<any> {
    return this.depositService.getDeposit(deposit);
  }

  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllDeposit(): Promise<any> {
    return this.depositService.getAllDeposit();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createDeposit(@Body() createDepositDto: CreateDepositDto): Promise<any> {
    return this.depositService.createDeposit(createDepositDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateDepositRoute(@Body() deposit: UpdateDepositDto): Promise<any> {
    return this.depositService.updateDeposit(deposit);
  }
}
