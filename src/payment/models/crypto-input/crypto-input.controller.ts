import { Controller, UseGuards, Put, Body, Param, Get, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoInput, TypedCryptoInput } from './crypto-input.entity';
import { CryptoInputService } from './crypto-input.service';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';

@ApiTags('cryptoInput')
@Controller('cryptoInput')
export class CryptoInputController {
  constructor(private readonly cryptoInputService: CryptoInputService) {}

  @Get('untyped')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUntyped(@Query() { minId, startDate }: { minId?: string; startDate?: string }): Promise<CryptoInput[]> {
    return await this.cryptoInputService.getUntyped(minId ? +minId : 1, startDate ? new Date(startDate) : new Date(0));
  }

  @Get('typed')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getWithType(
    @Query() { minId, startDate }: { minId?: string; startDate?: string },
  ): Promise<TypedCryptoInput[]> {
    return await this.cryptoInputService.getWithType(minId ? +minId : 1, startDate ? new Date(startDate) : new Date(0));
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    return this.cryptoInputService.update(+id, dto);
  }
}
