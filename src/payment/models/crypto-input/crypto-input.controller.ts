import { Controller, UseGuards, Put, Body, Param, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputService } from './crypto-input.service';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';

@ApiTags('cryptoInput')
@Controller('cryptoInput')
export class CryptoInputController {
  constructor(private readonly cryptoInputService: CryptoInputService) {}

  @Get('balance')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBalance(): Promise<{
    problem: CryptoInput[];
    sell: CryptoInput[];
    staking: CryptoInput[];
    payback: CryptoInput[];
  }> {
    return {
      problem: await this.cryptoInputService.getProblems(),
      sell: await this.cryptoInputService.getAllSellInputs(),
      staking: await this.cryptoInputService.getAllStakingInputs(),
      payback: await this.cryptoInputService.getAllPaybackInputs(),
    };
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    return this.cryptoInputService.update(+id, dto);
  }
}
