import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankService } from './bank.service';
import { BankDto } from './dto/bank.dto';
import { BankMapper } from './dto/bank.mapper';

@ApiTags('Bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllBanks(): Promise<BankDto[]> {
    const banks = await this.bankService.getAllBanks();

    return banks.map(BankMapper.toDto);
  }
}
