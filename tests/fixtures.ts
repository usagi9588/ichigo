// Test-only recruiting site. Not mounted by the production application.
export function fixtureResponse(path: string, method = 'GET', cookie = '', alternatePort = 4186): { status: number; headers: Record<string,string>; body: string } {
  const pathname = new URL(path, 'http://127.0.0.1').pathname;
  const html = (body: string, status = 200) => ({status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'},body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Ichigo Test Careers</title></head><body style="font:18px sans-serif;max-width:800px;margin:40px auto;line-height:1.8">${body}</body></html>`});
  if(pathname==='/login'&&method==='POST') return {status:303,headers:{location:'/jobs/private','set-cookie':'test-login=1; Path=/; HttpOnly; SameSite=Lax'},body:''};
  if(pathname==='/login'||(pathname==='/jobs/private'&&!cookie.includes('test-login=1')))return html('<h1>Please sign in first</h1><form method="post" action="/login"><button>Mock Sign In</button></form>');
  if(pathname==='/redirect')return {status:302,headers:{location:`http://127.0.0.1:${alternatePort}/apply`},body:''};
  if(pathname==='/fail')return html('<h1>Mock load failure</h1>',503);
  if(pathname==='/apply'&&method==='POST')return html('<h1>Mock application submitted</h1><p>Local test only; no data was sent to any recruiter.</p>');
  if(pathname==='/apply')return html('<h1>Ichigo Test Application</h1><form method="post" action="/apply"><label>Test Name<input name="name" required></label><button>Submit Local Mock Application</button></form>');
  if(pathname==='/unrelated')return html('<h1>Unrelated page: keep open when closing the application</h1>');
  if(pathname.startsWith('/jobs/'))return html(`<header data-company>Ichigo Test Company</header><h1>AI Engineer — Local Integration Test</h1><p data-location>Toronto · Remote</p><main><h2>About the role</h2>${'<p>Build and evaluate language model applications. This is a local fixture, not a real opening.</p>'.repeat(30)}</main><a target="_blank" href="http://127.0.0.1:${alternatePort}/apply">Open application popup</a><a href="/redirect">Cross-origin navigation</a>`);
  return html('<h1>Page not found</h1>',404);
}
