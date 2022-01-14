import { Controller, UseGuards, Put, Body, Param, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoBuy } from './crypto-buy.entity';
import { CryptoBuyService } from './crypto-buy.service';
import { CreateCryptoBuyDto } from './dto/create-crypto-buy.dto';
import { UpdateCryptoBuyDto } from './dto/update-crypto-buy.dto';

@ApiTags('cryptoBuy')
@Controller('cryptoBuy')
export class CryptoBuyController {
  constructor(private readonly cryptoBuyService: CryptoBuyService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.cryptoBuyService.updateVolumes();
  }

  @Put('refVolumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRefVolumes(): Promise<void> {
    return this.cryptoBuyService.updateRefVolumes();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateCryptoBuyDto): Promise<CryptoBuy> {
    return this.cryptoBuyService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoBuyDto): Promise<CryptoBuy> {
    return this.cryptoBuyService.update(+id, dto);
  }
}
