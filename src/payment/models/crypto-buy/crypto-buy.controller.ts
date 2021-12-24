import { Controller, UseGuards, Put, Body, Param, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoBuy } from './crypto-buy.entity';
import { CryptoBuyService } from './crypto-buy.service';
import { CryptoBuyDto } from './dto/crypto-buy.dto';

@ApiTags('cryptoBuy')
@Controller('cryptoBuy')
export class CryptoBuyController {
  constructor(private readonly cryptoBuyService: CryptoBuyService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CryptoBuyDto): Promise<CryptoBuy> {
    return this.cryptoBuyService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: number, @Body() dto: CryptoBuyDto): Promise<CryptoBuy> {
    return this.cryptoBuyService.update(id, dto);
  }
}
