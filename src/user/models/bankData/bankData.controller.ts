import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataDto } from 'src/user/models/bankData/dto/bankData.dto';
import { BankDataService } from 'src/user/models/bankData/bankData.service';

@ApiTags('bankData')
@Controller('bankData')
export class BankDataController {
  constructor(private readonly bankDataService: BankDataService) {}

  @Post(':id/delete')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async deleteBankData(@Param('id') id: number): Promise<any> {
    return await this.bankDataService.deleteBankData(+id);
  }

  @Post(':id/update')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBankData(@Param('id') id: number, @Body() bankDataDto: BankDataDto): Promise<any> {
    return await this.bankDataService.updateBankData(+id, bankDataDto);
  }
}
