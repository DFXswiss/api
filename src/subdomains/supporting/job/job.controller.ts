// Account ownership on the JWT payload uses `account` (user data ID), as defined in
// src/shared/auth/jwt-payload.interface.ts — not `id`.
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { JobDtoMapper } from './dto/job-dto.mapper';
import { JobDto } from './dto/job.dto';
import { JobService } from './services/job.service';

@ApiTags('Job')
@Controller('job')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Get(':uid')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: JobDto })
  async getJob(@GetJwt() jwt: JwtPayload | undefined, @Param('uid') uid: string): Promise<JobDto> {
    const job = await this.jobService.getByUid(uid);
    if (!job) throw new NotFoundException('Job not found');

    // Avoids confirming the existence of another account's job to an unauthorized caller
    // (same message, same status, whether the job doesn't exist or belongs to someone else).
    if (job.userData && jwt !== undefined && jwt.account !== job.userData.id) {
      throw new NotFoundException('Job not found');
    }

    // If no JWT is present, the uid itself is treated as sufficient proof of ownership (it is a
    // random value known only to whoever triggered the job) — same trust level as the confirmation
    // link that originates the job.

    const config = await this.jobService.getConfig(job.group);
    return JobDtoMapper.mapJob(job, config);
  }
}
