import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { DfxLogger } from '../services/dfx-logger';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new DfxLogger(ApiExceptionFilter);

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      // log server errors
      this.logger.error(`Exception during request to '${request.url}':`, exception);
    }

    response.status(status).json(
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode: status,
            message: exception.message,
          },
    );
  }
}
