import { Body, Controller, Get, Param, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankService } from './bank.service';

@ApiTags('bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'integer for the blz',
    schema: { type: 'integer' },
  })
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBankById(@Param() blz: any): Promise<any> {
    return this.bankService.getBankByBlz(blz);
  }

  @Get(':bankName')
  @ApiBearerAuth()
  @ApiParam({
    name: 'bankName',
    required: true,
    description: 'string for bankName',
    schema: { type: 'string' },
  })
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBankByName(@Param() bankName: any): Promise<any> {
    return this.bankService.getBankByBlz(bankName);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllBatch(): Promise<any> {
    return this.bankService.getAllBank();
  }
}
