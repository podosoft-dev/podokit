// Stable, language-independent error codes. The frontend branches on `code`,
// not on the human-readable message.
export class AppException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppException";
  }
}
