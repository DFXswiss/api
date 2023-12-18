import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankAccount } from './bank-account.entity';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@ApiTags('BankAccount')
@Controller('bankAccount/admin')
@ApiExcludeController()
export class BankAccountAdminController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async createBankAccountAdmin(
    @Query('userId') id: string,
    @Body() createBankAccountDto: CreateBankAccountDto,
  ): Promise<BankAccount> {
    return this.bankAccountService.createBankAccount(+id, createBankAccountDto);
  }
}
