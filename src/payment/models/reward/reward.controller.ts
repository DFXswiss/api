import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingRewardDto } from '../staking-reward/dto/staking-reward.dto';
import { StakingRewardController } from '../staking-reward/staking-reward.controller';

@ApiTags('reward')
@Controller('reward')
export class RouteController {
  constructor() {}
}
