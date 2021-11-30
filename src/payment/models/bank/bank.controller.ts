import { Body, Controller, Get, Param, UseGuards, Post, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankInfo } from './dto/bank.dto';
import { BankService } from './bank.service';

@ApiTags('bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBankByName(@Query('bankName') bankName: string, @Query('blz') blz: number): Promise<any> {
    if (bankName) return this.bankService.getBankByName(bankName);
    if (blz) return this.bankService.getBankByBlz(blz);
    return this.bankService.getAllBank();
  }
}
