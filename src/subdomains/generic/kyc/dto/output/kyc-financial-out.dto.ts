import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType } from '../../enums/kyc.enum';
import { KycFinancialInData } from '../input/kyc-financial-in.dto';

export class KycFinancialOption {
  @ApiProperty({ description: 'Option key' })
  key: string;

  @ApiProperty({ description: 'Option text (translated)' })
  text: string;
}

export class KycFinancialCondition {
  @ApiProperty({ description: 'Question key this condition depends on' })
  question: string;

  @ApiProperty({ description: 'Response value that makes the dependent question applicable' })
  response: string;
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

  @ApiPropertyOptional({
    description:
      'Conditions under which this question applies. If set, the question is only required when at least one condition matches the given responses.',
    type: KycFinancialCondition,
    isArray: true,
  })
  conditions?: KycFinancialCondition[];
}

export class KycFinancialOutData extends KycFinancialInData {
  @ApiProperty({ type: KycFinancialQuestion, isArray: true })
  questions: KycFinancialQuestion[];
}
