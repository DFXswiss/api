import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankService } from './bank.service';
import { BankDto } from './dto/bank.dto';
import { BankDtoMapper } from './dto/bank-dto.mapper';

@ApiTags('Bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllBanks(): Promise<BankDto[]> {
    return this.bankService.getAllBanks().then(BankDtoMapper.entitiesToDto);
  }
}
