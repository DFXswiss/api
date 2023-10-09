import { Controller, Put, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnService } from './bank-tx-return.service';
import { UpdateBankTxReturnDto } from './dto/update-bank-tx-return.dto';

@ApiTags('bankTxReturn')
@Controller('bankTxReturn')
export class BankTxReturnController {
  constructor(private readonly bankTxReturnService: BankTxReturnService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateBankTxReturnDto): Promise<BankTxReturn> {
    return this.bankTxReturnService.update(+id, dto);
  }
}
