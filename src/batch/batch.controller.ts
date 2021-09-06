import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    UseGuards,
    Post,
    UsePipes,
    ValidationPipe,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
  import { RoleGuard } from 'src/guards/role.guard';
  import { UserRole } from 'src/user/user.entity';
  import { BatchService } from './batch.service';
  import { CreateBatchDto } from './dto/create-batch.dto';
  import { UpdateBatchDto } from './dto/update-batch.dto';
  
  @ApiTags('batch')
  @Controller('batch')
  export class BatchController {
    constructor(private readonly batchService: BatchService) {}
  
    @Get(':key')
    @ApiParam({
      name: 'key',
      required: true,
      description:
        'either an integer for the batch id or a string for the batch name',
      schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    })
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getBatch(@Param() batch: any): Promise<any> {
      return this.batchService.getBatch(batch);
    }
  
    @Get()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllBatch(): Promise<any> {
      return this.batchService.getAllBatch();
    }
  
    @Post()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    createBatch(@Body() createBatchDto: CreateBatchDto): Promise<any> {
      return this.batchService.createBatch(createBatchDto);
    }
  
    @Put()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    async updateBatch(@Body() batch: UpdateBatchDto) {
      return this.batchService.updateBatch(batch);
    }
  }