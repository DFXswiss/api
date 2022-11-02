export enum CfpVote {
  YES = 'Yes',
  NO = 'No',
  NEUTRAL = 'Neutral',
}

export interface CfpVotes {
  [number: number]: CfpVote;
}
