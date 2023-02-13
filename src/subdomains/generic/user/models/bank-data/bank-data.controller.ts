import { Body, Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/bank-data.dto';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankData } from './bank-data.entity';

@ApiTags('bankData')
@Controller('bankData')
export class BankDataController {
  constructor(private readonly bankDataService: BankDataService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBankData(@Param('id') id: string, @Body() dto: BankDataDto): Promise<BankData> {
    return this.bankDataService.updateBankData(+id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async deleteBankData(@Param('id') id: string): Promise<void> {
    return this.bankDataService.deleteBankData(+id);
  }
}
