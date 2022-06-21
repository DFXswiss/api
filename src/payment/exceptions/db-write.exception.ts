export class DBWriteError extends Error {
  constructor(commandName: string, e: Error) {
    console.error(`Failed to perform write command '${commandName}' to the DB`, e);
    super(`Failed to perform write command '${commandName}' to the DB`);
  }
}
