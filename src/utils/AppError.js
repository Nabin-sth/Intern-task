export class AppError extends Error {
  /**
   * Operational HTTP error. Unknown errors are wrapped in the error handler.
   * @param {string} message
   * @param {number} statusCode
   * @param {object} [details]
   */
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
