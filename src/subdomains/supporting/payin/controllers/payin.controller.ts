import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';
import { PayInService } from '../services/payin.service';

@ApiTags('Pay-In')
@Controller('payIn')
export class PayInController {
  constructor(private readonly payInService: PayInService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createPayIn(@Body() payIn: PayInEntry): Promise<CryptoInput[]> {
    return this.payInService.createPayIns([payIn]);
  }
}
