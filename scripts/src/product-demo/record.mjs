import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, makeRecorder, sleep } from './browser.mjs';
import { signIn, directory, origin, fixture, clickText, choose } from './access.mjs';

const scenes = [];
let browser;
async function closeBanner() {
  await browser.evaluate(`document.querySelector('[aria-label="Close banner"]')?.click()`);
}
async function page(path) {
  await browser.goto(origin + path); await sleep(5000); await closeBanner();
}
async function scene(id, title, caption, action = async () => {}, hold = 6500) {
  const dir = `${directory}/capture/${String(scenes.length).padStart(2, '0')}-${id}`;
  const recorder = await makeRecorder(browser, dir);
  await recorder.start();
  await action();
  await sleep(hold);
  const captured = await recorder.stop();
  await browser.screenshot(`${dir}/review.jpg`);
  scenes.push({ id, dir, title, caption, ...captured });
  await writeFile(`${directory}/scenes.json`, JSON.stringify(scenes, null, 2));
  console.log(`Captured ${id}: ${captured.duration.toFixed(1)} seconds of actual application footage`);
}
async function newActor(role) {
  if (browser) { await browser.close(); await sleep(700); }
  browser = await launchBrowser();
  await signIn(browser, role); await closeBanner();
}
async function mustClick(text, options) {
  if (!await clickText(browser, text, options)) throw Error(`Required UI control not available: ${text}`);
}
try {
  browser = await launchBrowser();
  await page('/');
  await scene('intro', 'Yetenia EduCore | Real application walkthrough',
    'Current Development UI. All school records shown belong to a newly created fictional demo school.',
    async () => {}, 6500);
  await scene('owner-unavailable', 'Platform Owner | Not recorded',
    'No isolated demo Owner was authorized. Global school and financial records are deliberately excluded.',
    async () => {}, 5500);

  await newActor('admin'); await page('/dashboard');
  await scene('admin-overview', 'School Admin | Command centre',
    'A real, school-scoped dashboard: three fictional learners, one teacher and the active academic period.');
  await page('/students');
  await scene('admin-students', 'School Admin | Student directory',
    'Searchable student records and guardian-management tools, using fictional learners only.',
    async () => {
      await browser.evaluate(`(()=>{
        const e=document.querySelector('input[placeholder*="Search"]');
        if(e){const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'Demo Learner');e.dispatchEvent(new Event('input',{bubbles:true}));}
      })()`);
      await sleep(1800);
    });
  await page('/attendance');
  await scene('admin-attendance', 'School Admin | Attendance review',
    'School entry and classroom attendance are separate records. These examples were manually seeded, not read from hardware.',
    async () => {
      await browser.evaluate('window.scrollBy({top:280,behavior:"smooth"})');
    });
  await page('/results');
  await scene('admin-academics', 'School Admin | Academic oversight',
    'Select the actual academic session, term, class and section to review the demo class.',
    async () => {
      if (!await choose(browser, 2, fixture.classId)) throw Error('Class selection missing');
      await sleep(1400);
      await choose(browser, 3, 'A'); await sleep(2800);
    }, 7000);
  await page('/finance');
  await scene('admin-fees', 'School Admin | School-issued fees',
    'One fictional invoice is unpaid. No payment, bank verification, transfer or financial action is performed.',
    async () => { await browser.evaluate('window.scrollBy({top:180,behavior:"smooth"})'); });

  await newActor('teacher'); await page('/attendance');
  await scene('teacher-attendance', 'Teacher | Assigned-class attendance',
    'The teacher selects JSS1 A from an authorized class dropdown, then views that class for the selected school day.',
    async () => {
      if (!await choose(browser, 0, fixture.classId)) throw Error('Assigned class selection missing');
      await sleep(3500);
    }, 7500);
  await page('/results');
  await scene('teacher-results', 'Teacher | Assigned subjects and result entry',
    'Only assigned subjects are available. This opens the real entry sheet; no scores are submitted during the recording.',
    async () => {
      await mustClick('Enter Result'); await sleep(4000);
    }, 8000);

  await newActor('parent'); await page('/parent');
  await scene('parent-overview', 'Parent | Protected family portal',
    'The new demo guardian can see only the linked fictional child. No unrelated family records are opened.');
  await scene('parent-attendance', 'Parent | Child attendance',
    'Open the linked learner to review school entry and classroom attendance.',
    async () => {
      await mustClick('Demo Learner', { exact: false }); await sleep(3500);
      await browser.evaluate('window.scrollBy({top:280,behavior:"smooth"})');
    }, 7000);
  await scene('parent-results', 'Parent | Published academic results',
    'Published sample scores and school remarks are read from the real academic portal.',
    async () => {
      await mustClick('Results'); await sleep(2200);
      await browser.evaluate('window.scrollBy({top:180,behavior:"smooth"})');
    }, 6500);
  await scene('parent-report', 'Parent | Report card and print-to-PDF',
    'The real report-card print action is used. The app-generated report is also exported as a PDF; no direct-download button is invented.',
    async () => {
      await mustClick('Exam/Record'); await sleep(2800);
      await mustClick('Print report card'); await sleep(2500);
      const html = await browser.evaluate(`(()=>{
        const f=[...document.querySelectorAll('iframe')].find(f=>f.contentDocument?.querySelector('[data-school-print-root]'));
        return f?.contentDocument?.documentElement.outerHTML??null;
      })()`);
      if (!html || !html.includes('Demo Learner') || !html.includes('FICTIONAL')) {
        throw Error('Actual app-generated fictional print document was not available');
      }
      await writeFile(`${directory}/actual-app-report.html`, '<!doctype html>' + html);
      await browser.evaluate('window.scrollBy({top:160,behavior:"smooth"})');
    }, 6000);

  await newActor('student'); await page('/dashboard');
  await scene('student-overview', 'Student | Academic portal',
    'The learner sees their own school profile and recent attendance in the actual Student portal.');
  await page('/results');
  await scene('student-results', 'Student | Published term report',
    'The Student portal displays the fictional learner’s published subject scores, grades and report-card print action.');
  await page('/my-fees');
  await scene('student-fees', 'Student | School-issued fees only',
    'My Fees shows the fictional school invoice and balance, without platform subscription pricing or payment instructions.');
  await page('/results');
  await scene('closing', 'Yetenia EduCore | End of real-app demo',
    'Recorded in Development with fictional records. Owner access was unavailable. No payments, external messages or Production changes.',
    async () => {}, 6500);
  console.log(`Capture complete: ${scenes.length} real-screen segments`);
} finally {
  await browser?.close();
}
