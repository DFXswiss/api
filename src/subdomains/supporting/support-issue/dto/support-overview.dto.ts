import { ApiProperty } from '@nestjs/swagger';

export class SupportOverviewDto {
  @ApiProperty({ description: 'All open (non-terminal) tickets in scope' })
  openTotal: number;

  @ApiProperty({ description: 'Clerk mapped to the caller account, null if unmapped', type: String, nullable: true })
  clerk: string | null;

  @ApiProperty({ description: "Open tickets assigned to the caller's clerk (0 if unmapped)" })
  myTickets: number;

  @ApiProperty({ description: 'Open LIMIT_REQUEST tickets' })
  limitRequests: number;

  @ApiProperty({
    type: [Number],
    description: 'Cumulative counts of customer-waiting tickets at [>=1h, >=12h, >=24h]',
  })
  waitingLongerThan: number[];
}
