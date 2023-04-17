import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('transactionSpecification')
@Controller('transactionSpecification')
export class TransactionSpecificationController {}
