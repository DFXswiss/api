import { Body, Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankData } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@ApiTags('bankData')
@Controller('bankData')
export class BankDataController {
  constructor(private readonly bankDataService: BankDataService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBankData(@Param('id') id: string, @Body() dto: UpdateBankDataDto): Promise<BankData> {
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
