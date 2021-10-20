import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  catch(exception: { message: string }, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) {
      // log server errors
      console.log(`Exception during request: ${exception}`);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(status).json({
      message: exception.message,
      statusCode: status,
    });
  }
}
