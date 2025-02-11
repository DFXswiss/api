import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { BankTxRepeat } from './bank-tx-repeat.entity';
import { BankTxRepeatService } from './bank-tx-repeat.service';
import { UpdateBankTxRepeatDto } from './dto/update-bank-tx-repeat.dto';

@ApiTags('bankTxRepeat')
@Controller('bankTxRepeat')
export class BankTxRepeatController {
  constructor(private readonly bankTxRepeatService: BankTxRepeatService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateBankTxRepeatDto): Promise<BankTxRepeat> {
    return this.bankTxRepeatService.update(+id, dto);
  }
}
