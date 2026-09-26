/** §11.4 / F4: opted-out stars answer 410 Gone. */
export function GET(req: Request) {
  const login = (new URL(req.url).searchParams.get('login') ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 39);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Removed · Commitverse</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#03040a;color:#e8ecf6;font:15px/1.6 system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}a{color:#7cc4ff}p{color:#9aa4bd}</style></head>
<body><main><h1 style="font-size:20px;font-weight:600">This star was removed</h1><p>@${login} asked to be removed from the universe. Their data has been deleted.</p><p><a href="/">Back to the universe</a></p></main></body></html>`;
  return new Response(html, {
    status: 410,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
