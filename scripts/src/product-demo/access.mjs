import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { sleep } from './browser.mjs';
const req = createRequire(new URL('../../../artifacts/api-server/package.json', import.meta.url));
const { clerkClient } = req('@clerk/express');
export const directory = 'generated-artifacts/educore-product-demo';
export const fixture = JSON.parse(await readFile(`${directory}/private-fixture.json`, 'utf8'));
export const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
export async function signIn(browser, role) {
  if (!fixture.complete || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
    throw Error('Only completed, authorized Development fixture accounts are allowed');
  }
  await browser.goto(origin);
  for (let i = 0; i < 35; i++) {
    if (await browser.evaluate('!!window.Clerk?.loaded')) break;
    await sleep(500);
  }
  if (!await browser.evaluate('!!window.Clerk?.loaded')) throw Error('Clerk did not load in recording browser');
  // Genuine, short-lived Clerk sign-in ticket for the newly authorized actor.
  // No claim overrides, mock authentication, credentials in video, or app changes.
  const ticket = await clerkClient.signInTokens.createSignInToken({
    userId: fixture.actors[role].clerkUserId, expiresInSeconds: 120,
  });
  await browser.evaluate(`(async()=>{
    const result=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:${JSON.stringify(ticket.token)}});
    if(result.status!=='complete'||!result.createdSessionId) throw Error('Authentication incomplete');
    await window.Clerk.setActive({session:result.createdSessionId}); return true;
  })()`);
  await browser.goto(`${origin}/dashboard`);
  const context = await browser.evaluate(`fetch('/api/me/authorized-context').then(async r=>({status:r.status,body:await r.json()})).catch(()=>({status:0}))`);
  if (context.status !== 200 || context.body?.user?.id !== fixture.actors[role].userId ||
      !context.body?.roles?.some(r => r.schoolId === fixture.schoolId && r.role === fixture.actors[role].role && r.status === 'ACTIVE')) {
    throw Error('Recording actor or school authorization could not be verified');
  }
  await sleep(5000);
  return context.status;
}
export async function clickText(browser, text, { exact = true } = {}) {
  return browser.evaluate(`(()=>{
    const needle=${JSON.stringify(text)};
    const e=[...document.querySelectorAll('button,a,[role=tab]')]
      .find(e=>e.getBoundingClientRect().width>0 && ${exact
    ? 'e.innerText.trim()===needle' : 'e.innerText.includes(needle)'});
    if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true;
  })()`);
}
export async function choose(browser, index, value) {
  return browser.evaluate(`(()=>{
    const el=[...document.querySelectorAll('select')][${index}];
    if(!el)return false;el.value=${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
}
