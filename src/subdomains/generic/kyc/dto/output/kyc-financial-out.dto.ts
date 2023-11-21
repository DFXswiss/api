import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycFinancialInData } from '../input/kyc-financial-in.dto';

export enum QuestionType {
  CONFIRMATION = 'Confirmation',
  SINGLE_CHOICE = 'SingleChoice',
  MULTIPLE_CHOICE = 'MultipleChoice',
  TEXT = 'Text',
}

export class KycFinancialOption {
  @ApiProperty({ description: 'Option key' })
  key: string;

  @ApiProperty({ description: 'Option text (translated)' })
  text: string;
}

export class KycFinancialQuestion {
  @ApiProperty({ description: 'Question key' })
  key: string;

  @ApiProperty({ description: 'Question key', enum: QuestionType })
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
