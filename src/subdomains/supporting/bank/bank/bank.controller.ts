import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankService } from './bank.service';
import { Bank } from './bank.entity';

@ApiTags('bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBanks(): Promise<Bank[]> {
    return this.bankService.getAllBanks();
  }
}
