import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DfxLogger } from '../../logger/dfx-logger.service';

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
      this.logger.error(`Exception during ${request.method} request to '${request.url}':`, exception);
    }

    try {
      response.status(status).json(
        exception instanceof HttpException
          ? exception.getResponse()
          : {
              statusCode: status,
              message: exception.message,
            },
      );
    } catch (e) {
      this.logger.error(`Failed to set error response content:`, e);
    }
  }
}
