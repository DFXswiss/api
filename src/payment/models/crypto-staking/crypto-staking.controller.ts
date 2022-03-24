import { Controller, UseGuards, Put, Body, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoStaking } from './crypto-staking.entity';
import { CryptoStakingService } from './crypto-staking.service';
import { UpdateCryptoStakingDto } from './dto/update-crypto-staking.dto';

@ApiTags('cryptoStaking')
@Controller('cryptoStaking')
export class CryptoStakingController {
  constructor(private readonly cryptoStakingService: CryptoStakingService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    return this.cryptoStakingService.update(+id, dto);
  }
}
