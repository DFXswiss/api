import { Body, Controller, Get, Param, UseGuards, Post, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankService } from './bank.service';

@ApiTags('bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  // @Get('id/:id')
  // @ApiBearerAuth()
  // @ApiParam({
  //   name: 'id',
  //   required: true,
  //   description: 'integer for id',
  //   schema: { type: 'integer' },
  // })
  // @ApiExcludeEndpoint()
  // @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  // async getBankById(@Param() id: number): Promise<any> {
  //   return this.bankService.getBankById(id);
  // }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBankByName(@Query('bankName') bankName: string, @Query('blz') blz: string): Promise<any> {
    if (bankName) return this.bankService.getBankByName(bankName);
    if (blz) return this.bankService.getBankByBlz(blz);
    return this.bankService.getAllBank();
  }
}
