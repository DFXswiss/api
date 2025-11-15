import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateRecommendationDto, RecommendationDto, UpdateRecommendationDto } from './dto/recommendation.dto';
import { RecommendationDtoMapper } from './mapper/recommendation-dto.mapper';
import { RecommendationService } from './recommendation.service';

@ApiTags('recommendation')
@Controller('recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async getOwnRecommendation(@GetJwt() jwt: JwtPayload): Promise<RecommendationDto[]> {
    return this.recommendationService
      .getOwnRecommendationForUserData(jwt.account)
      .then((r) => RecommendationDtoMapper.entitiesToDto(r, false));
  }

  @Get('all')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async getAllRecommendation(@GetJwt() jwt: JwtPayload): Promise<RecommendationDto[]> {
    return this.recommendationService
      .getAllRecommendationForUserData(jwt.account)
      .then((r) => RecommendationDtoMapper.entitiesToDto(r));
  }

  @Get('pending')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async getAllPendingRecommendation(@GetJwt() jwt: JwtPayload): Promise<RecommendationDto[]> {
    return this.recommendationService
      .getAllRecommendationForUserData(jwt.account, true)
      .then((r) => RecommendationDtoMapper.entitiesToDto(r));
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async confirmRecommendation(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() data: UpdateRecommendationDto,
  ): Promise<void> {
    await this.recommendationService.updateRecommendation(jwt.account, +id, data);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async createRecommendation(
    @GetJwt() jwt: JwtPayload,
    @Body() data: CreateRecommendationDto,
  ): Promise<RecommendationDto> {
    return this.recommendationService
      .createRecommendationByRecommender(jwt.account, data)
      .then((r) => RecommendationDtoMapper.entityToDto(r));
  }
}
