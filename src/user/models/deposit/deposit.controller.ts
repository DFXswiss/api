import { Body, Controller, Get, Param, Put, UseGuards, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from 'src/user/models/deposit/dto/create-deposit.dto';
import { UpdateDepositDto } from './dto/update-deposit.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';

@ApiTags('deposit')
@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Get(':key')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getDeposit(@Param() deposit: any): Promise<any> {
    return this.depositService.getDeposit(deposit);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllDeposit(): Promise<any> {
    return this.depositService.getAllDeposit();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createDeposit(@Body() createDepositDto: CreateDepositDto): Promise<any> {
    return this.depositService.createDeposit(createDepositDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateDepositRoute(@Body() deposit: UpdateDepositDto): Promise<any> {
    return this.depositService.updateDeposit(deposit);
  }
}
