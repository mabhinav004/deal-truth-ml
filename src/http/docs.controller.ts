import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, errorEnvelope } from '../core/errors';
import { openApiSpec, swaggerUiHtml } from '../openapi';
import { getReferenceDoc, listReferenceDocs } from '../reference';
import type { RequestContext } from './request-context';

@Controller()
export class DocsController {
  @Get('openapi.json')
  openApi(): typeof openApiSpec {
    return openApiSpec;
  }

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  swagger(): string {
    return swaggerUiHtml('/openapi.json');
  }

  @Get('v1/reference')
  v1Index(): { docs: ReturnType<typeof listReferenceDocs> } {
    return { docs: listReferenceDocs('/v1/reference') };
  }

  @Get('api/v1/reference')
  apiIndex(): { docs: ReturnType<typeof listReferenceDocs> } {
    return { docs: listReferenceDocs('/api/v1/reference') };
  }

  @Get('v1/reference/:name')
  v1Doc(
    @Param('name') name: string,
    @Req() request: Request & RequestContext,
    @Res() response: Response,
  ): void {
    sendReferenceDoc(name, request.requestId, response);
  }

  @Get('api/v1/reference/:name')
  apiDoc(
    @Param('name') name: string,
    @Req() request: Request & RequestContext,
    @Res() response: Response,
  ): void {
    sendReferenceDoc(name, request.requestId, response);
  }
}

function sendReferenceDoc(name: string, requestId: string, response: Response): void {
  const doc = getReferenceDoc(name);
  if (!doc) {
    response
      .status(404)
      .json(errorEnvelope(new AppError('INVALID_REQUEST', 'Unknown reference document.'), requestId));
    return;
  }
  response.status(200).type('text/markdown; charset=utf-8').send(doc.body);
}
