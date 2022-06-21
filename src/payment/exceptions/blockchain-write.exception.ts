export class BlockchainWriteError extends Error {
  constructor(commandName: string, e: Error) {
    console.error(`Failed to perform write command '${commandName}' on the blockchain`, e);
    super(`Failed to perform write command '${commandName}' on the blockchain`);
  }
}
