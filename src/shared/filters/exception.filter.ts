import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  catch(exception: { message: string }, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      // log server errors
      console.error(`Exception during request to '${request.url}':`, exception);
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
