import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateMasternodeDto } from './dto/create-masternode.dto';
import { UpdateMasternodeDto } from './dto/update-masternode.dto';
import { Masternode } from './masternode.entity';
import { MasternodeService } from './masternode.service';

@ApiTags('masternode')
@Controller('masternode')
export class MasternodeController {
  constructor(private readonly masternodeService: MasternodeService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  createMasternode(@Body() dto: CreateMasternodeDto): Promise<Masternode> {
    return this.masternodeService.create(dto);
  }

  @Put(':hash')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async updateMasternodeRoute(@Param('hash') hash: string, @Body() dto: UpdateMasternodeDto): Promise<Masternode> {
    return this.masternodeService.update(hash, dto);
  }
}
