import { JobGroup } from '../enums';

// Handlers are registered from the outside (JobService.registerHandler) so the job module
// does not import domain modules and no circular dependency forms.
export interface JobHandler<TInput = unknown, TOutput = unknown> {
  readonly group: JobGroup;
  execute(input: TInput): Promise<TOutput>;
}
