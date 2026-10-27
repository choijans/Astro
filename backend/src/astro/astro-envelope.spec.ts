import { AstroApiError } from './astro-client.interface';
import { parseAstroEnvelope } from './astro-envelope';
import { AstroSearchLinearResponse } from './astro.types';

function makeResponse(
  overrides: Partial<AstroSearchLinearResponse> = {},
): AstroSearchLinearResponse {
  return {
    responseCode: 200,
    responseMessage: 'OK',
    response: {
      channels: { data: [], pagination: {} },
      linearContent: { data: ['should never be read'], pagination: {} },
    },
    ...overrides,
  };
}

describe('parseAstroEnvelope', () => {
  it('returns response.channels.data on a 200 responseCode', () => {
    const body = makeResponse({
      response: {
        channels: { data: [{ id: 1 } as never], pagination: {} },
        linearContent: { data: [], pagination: {} },
      },
    });

    expect(parseAstroEnvelope(body)).toEqual([{ id: 1 }]);
  });

  it('never returns or reads response.linearContent', () => {
    const body = makeResponse();
    const result = parseAstroEnvelope(body);
    expect(result).not.toBe(body.response.linearContent?.data);
  });

  it('throws AstroApiError on a bad responseCode', () => {
    const body = makeResponse({
      responseCode: 500,
      responseMessage: 'Internal error',
    });
    expect(() => parseAstroEnvelope(body)).toThrow(AstroApiError);
  });
});
