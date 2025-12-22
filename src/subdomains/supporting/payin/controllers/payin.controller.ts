import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInEntry, PollAddress } from '../interfaces';
import { PayInCardanoService } from '../services/payin-cardano.service';
import { PayInService } from '../services/payin.service';

@ApiTags('Pay-In')
@Controller('payIn')
export class PayInController {
  constructor(private readonly payInService: PayInService, private readonly payInCardanoService: PayInCardanoService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createPayIn(@Body() payIn: PayInEntry): Promise<CryptoInput[]> {
    return this.payInService.createPayIns([payIn]);
  }

  @Post('pollAddress')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async pollAddress(@Body() pollAddress: PollAddress): Promise<void> {
    return this.payInCardanoService.pollAddress(BlockchainAddress.create(pollAddress.address, pollAddress.blockchain));
  }
}
