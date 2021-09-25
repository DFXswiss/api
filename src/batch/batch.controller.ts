import { Body, Controller, Get, Param, Put, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { BatchRepository } from './batch.repository';
import { BatchService } from './batch.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';

@ApiTags('batch')
@Controller('batch')
export class BatchController {
  constructor(private readonly batchService: BatchService, private readonly batchRepo: BatchRepository) {}

  @Get('/payments')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllBatchPayments(): Promise<any> {
    return this.batchRepo.find({ relations: ['payments'] });
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'integer for the batch id',
    schema: { type: 'integer' },
  })
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBatch(@Param() id: any): Promise<any> {
    return this.batchRepo.findOne(id);
  }

  @Get(':id/payments')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'integer for the batch id',
    schema: { type: 'integer' },
  })
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBatchPayments(@Param() batchId: any): Promise<any> {
    return this.batchRepo.findOne({ where: { id: batchId.id }, relations: ['payments'] });
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllBatch(): Promise<any> {
    return this.batchRepo.find();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  createBatch(@Body() createBatchDto: CreateBatchDto): Promise<any> {
    return this.batchService.createBatch(createBatchDto);
  }

  // @Put()
  // @ApiBearerAuth()
  // @ApiExcludeEndpoint()
  // @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  // @UsePipes(ValidationPipe)
  // async updateBatch(@Body() batch: UpdateBatchDto) {
  //   return this.batchService.updateBatch(batch);
  // }
}
