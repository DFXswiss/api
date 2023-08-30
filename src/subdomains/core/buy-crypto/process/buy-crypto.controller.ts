import { Body, Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';
import { BuyCrypto } from './entities/buy-crypto.entity';
import { BuyCryptoService } from './services/buy-crypto.service';

@ApiTags('buyCrypto')
@Controller('buyCrypto')
export class BuyCryptoController {
  constructor(private readonly buyCryptoService: BuyCryptoService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.buyCryptoService.updateVolumes();
  }

  @Put('refVolumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRefVolumes(): Promise<void> {
    return this.buyCryptoService.updateRefVolumes();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    return this.buyCryptoService.update(+id, dto);
  }

  @Delete(':id/amlCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async resetAmlCheck(@Param('id') id: string): Promise<void> {
    return this.buyCryptoService.resetAmlCheck(+id);
  }
}
