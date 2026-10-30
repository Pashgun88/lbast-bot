const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: true, viewport: null });
  const all = await ctx.cookies('http://lbast.ru/');
  const keep = all.filter((c) => ['user_id', 'user_pass', 'lb_cookies_enabled', 'lb_design'].includes(c.name))
    .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
  const out = path.join(__dirname, 'session_cookies.json');
  fs.writeFileSync(out, JSON.stringify(keep, null, 2), 'utf8');
  console.log(`записал ${keep.length} куки в ${out}`);
  for (const c of keep) console.log(`${c.name} domain=${c.domain} path=${c.path} expires=${c.expires} httpOnly=${c.httpOnly}`);
  await ctx.close();
})();
