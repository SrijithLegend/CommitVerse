/** RFC 9457 problem details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function problem(status: number, code: string, detail?: string, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ type: `https://commitverse.dev/problems/${code}`, title: TITLES[status] ?? 'Error', status, detail, code }),
    { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...headers } },
  );
}

export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);
export const forbidden = (why = 'Forbidden') => new ApiError(403, 'forbidden', why);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in required');
export const badRequest = (why: string, code = 'bad_request') => new ApiError(400, code, why);
export const conflict = (why: string, code = 'conflict') => new ApiError(409, code, why);
