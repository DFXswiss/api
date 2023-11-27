import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType } from '../../enums/kyc.enum';
import { KycFinancialInData } from '../input/kyc-financial-in.dto';

export class KycFinancialOption {
  @ApiProperty({ description: 'Option key' })
  key: string;

  @ApiProperty({ description: 'Option text (translated)' })
  text: string;
}

export class KycFinancialQuestion {
  @ApiProperty({ description: 'Question key' })
  key: string;

  @ApiProperty({ description: 'Question type', enum: QuestionType })
  type: QuestionType;

  @ApiProperty({ description: 'Question title (translated)' })
  title: string;

  @ApiProperty({ description: 'Question description (translated)' })
  description: string;

  @ApiPropertyOptional({ description: 'Response options', type: KycFinancialOption, isArray: true })
  options?: KycFinancialOption[];
}

export class KycFinancialOutData extends KycFinancialInData {
  @ApiProperty({ type: KycFinancialQuestion, isArray: true })
  questions: KycFinancialQuestion[];
}
