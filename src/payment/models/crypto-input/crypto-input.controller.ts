import { Controller, UseGuards, Put, Body, Param, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoInput, MappedCryptoInput } from './crypto-input.entity';
import { CryptoInputService } from './crypto-input.service';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';

@ApiTags('cryptoInput')
@Controller('cryptoInput')
export class CryptoInputController {
  constructor(private readonly cryptoInputService: CryptoInputService) {}

  @Get('mapping/unmapped')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUnmapped(): Promise<MappedCryptoInput[]> {
    return await this.cryptoInputService.getUnmapped();
  }

  @Get('mapping')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getEntriesWithMapping(): Promise<MappedCryptoInput[]> {
    return await this.cryptoInputService.getAll();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    return this.cryptoInputService.update(+id, dto);
  }
}
