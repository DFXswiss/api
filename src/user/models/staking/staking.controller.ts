import { Body, Controller, Get, Put, UseGuards, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingService } from './staking.service';
import { Staking } from './staking.entity';
import { CreateStakingDto } from './dto/create-staking.dto';

@ApiTags('staking')
@Controller('staking')
export class StakingController {
  constructor(private readonly stakingService: StakingService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllStaking(@GetJwt() jwt: JwtPayload): Promise<Staking[]> {
    return this.stakingService.getAllStaking(jwt.id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createStaking(@GetJwt() jwt: JwtPayload, @Body() createStakingDto: CreateStakingDto): Promise<Staking> {
    return this.stakingService.createStaking(jwt.id, createStakingDto);
  }

  // @Put()
  // @ApiBearerAuth()
  // @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  // async updateStaking(@GetJwt() jwt: JwtPayload, @Body() updatestakingDto: UpdatestakingDto): Promise<Staking> {
  //   return this.stakingService.updateStaking(jwt.id, updatestakingDto);
  // }
}
