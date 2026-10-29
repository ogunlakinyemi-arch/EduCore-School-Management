import { launchBrowser, sleep } from './browser.mjs';
import { signIn, directory, origin, fixture, clickText } from './access.mjs';
const role = process.argv[2] ?? 'admin';
const browser = await launchBrowser();
try {
  await signIn(browser, role);
  const paths = role === 'admin' ? ['/dashboard', '/students', '/attendance', '/results', '/finance']
    : role === 'teacher' ? ['/attendance', '/results']
      : role === 'parent' ? ['/parent'] : ['/dashboard', '/results', '/my-fees'];
  for (const path of paths) {
    await browser.goto(origin + path); await sleep(5500);
    console.log(`SCREEN ${role} ${path}\n${(await browser.text()).slice(-6500)}`);
    console.log('SELECTS', await browser.evaluate(`[...document.querySelectorAll('select')].map((e,i)=>({i,value:e.value,options:[...e.options].map(o=>({value:o.value,text:o.textContent}))}))`));
    await browser.screenshot(`${directory}/${role}-${path.split('/').pop()}-inspection.jpg`);
  }
  if(role==='parent'){
    for(const text of ['Demo Learner','Academics','Report Cards']){
      console.log('CLICK', text, await clickText(browser,text,{exact:false}));await sleep(1800);
    }
    console.log('PARENT ACADEMICS', (await browser.text()).slice(-6500));
    console.log('BUTTON LABELS',await browser.evaluate(`[...document.querySelectorAll('button')].map(e=>({text:e.innerText,title:e.title,aria:e.getAttribute('aria-label')}))`));
    await browser.screenshot(`${directory}/parent-academics-inspection.jpg`);
  }
} finally { await browser.close(); await sleep(500); }
