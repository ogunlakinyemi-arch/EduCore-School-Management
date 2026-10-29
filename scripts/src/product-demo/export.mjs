import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = 'generated-artifacts/educore-product-demo';
const scenes = JSON.parse(await readFile(`${root}/scenes.json`, 'utf8'));
for (const scene of scenes) if (scene.id === 'teacher-results') {
  scene.title = 'Teacher | Assigned results — published, read-only';
  scene.caption = 'The real sheet shows published demo scores as locked and read-only. Only assigned subjects are visible; no scores are edited or submitted.';
}
if (scenes.length !== 17 || scenes.at(-1).id !== 'closing') {
  throw Error('Capture is incomplete; refusing to present a partial demo as complete');
}
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const wrap = (text, length = 163) => {
  const lines = [''];
  for (const word of text.split(/\s+/)) {
    if (lines.at(-1).length + word.length + 1 > length) lines.push(word);
    else lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
  }
  return lines.join('\n');
};
await mkdir(`${root}/encoded`, { recursive: true });
for (const [i, scene] of scenes.entries()) {
  const titlePath = `${scene.dir}/title.txt`, captionPath = `${scene.dir}/caption.txt`;
  await writeFile(titlePath, scene.title);
  await writeFile(captionPath, wrap(scene.caption));
  const filters = [
    'scale=1600:1000:force_original_aspect_ratio=decrease',
    'pad=1920:1080:(ow-iw)/2:0:color=0x0B1220',
    `drawtext=fontfile=${bold}:textfile=${resolve(titlePath)}:fontcolor=0xF4C344:fontsize=24:x=180:y=1007`,
    `drawtext=fontfile=${font}:textfile=${resolve(captionPath)}:fontcolor=white:fontsize=18:x=180:y=1039:line_spacing=4`,
    `drawtext=fontfile=${font}:text='DEVELOPMENT  |  FICTIONAL DATA':fontcolor=0xA6B4C8:fontsize=16:x=1450:y=1013`,
  ].join(',');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', `${scene.dir}/frames.ffconcat`,
    '-vf', filters, '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
    `${root}/encoded/${String(i).padStart(2, '0')}.mp4`],
  { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180000 });
  console.log(`Encoded actual-screen chapter ${i + 1}/${scenes.length}`);
}
await writeFile(`${root}/encoded/concat.txt`,
  scenes.map((s, i) => `file '${String(i).padStart(2, '0')}.mp4'`).join('\n'));
let elapsed = 0;
const chapters = [';FFMETADATA1', 'title=Yetenia EduCore — Actual Development Application Demo',
  'comment=Actual browser screencast. New fictional demo school only. Captioned, no narration. Platform Owner not recorded.'];
const stamp = ms => {
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60,
    seconds = Math.floor(ms / 1000) % 60, millis = ms % 1000;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')},${String(millis).padStart(3,'0')}`;
};
const srt = [];
for (const [i, scene] of scenes.entries()) {
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json',
    `${root}/encoded/${String(i).padStart(2, '0')}.mp4`], { encoding: 'utf8' }));
  const length = Math.round(Number(info.format.duration) * 1000);
  chapters.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${elapsed}`, `END=${elapsed + length}`,
    `title=${scene.title.replace(/([=;#\\])/g, '\\$1')}`);
  srt.push(`${i + 1}\n${stamp(elapsed)} --> ${stamp(elapsed + length)}\n${scene.title}\n${scene.caption}\n`);
  elapsed += length;
}
await writeFile(`${root}/chapters.txt`, chapters.join('\n'));
await writeFile(`${root}/Yetenia-EduCore-Real-App-Demo.srt`, srt.join('\n'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
  '-i', `${root}/encoded/concat.txt`, '-i', `${root}/chapters.txt`, '-map_metadata', '1', '-map_chapters', '1',
  '-c', 'copy', '-movflags', '+faststart', `${root}/Yetenia-EduCore-Real-App-Demo.mp4`],
{ stdio: ['ignore', 'ignore', 'inherit'], timeout: 60000 });
await writeFile(`${root}/README.txt`, `Yetenia EduCore — Real Development Application Demo

Video: Yetenia-EduCore-Real-App-Demo.mp4
Format: H.264 MP4, 1920×1080, 25 fps, captioned, no narration.
Source: continuous browser screencasts of the current running Development app,
edited into chapters. No reconstructed app UI, intercepted/mock API responses,
authentication claim overrides, or animated substitute screens.

Coverage:
- School Admin: dashboard, student directory, attendance, academic class review, school-issued fees.
- Teacher: authorized assigned-class dropdown, class attendance, assigned result-entry sheet.
- Parent: linked child, attendance, published results, real report-card print action.
- Student: own academic dashboard, published term report, school-issued fee view.
- Platform Owner: NOT RECORDED. No isolated demo Owner was authorized; global
  retained school/financial records were not opened.

All recorded school/family data belongs to the separately authorized fictional
Yetenia Demo Academy school. Sample academic publications are fixture data,
not a recording of an approval/publication operation. No scores were submitted
during capture. No platform Owner was created or impersonated.

The Parent UI offers Print report card, not a direct PDF-download button.
The exact app-generated print document is exported separately as Demo-Report-Card.pdf.
No payment, bank lookup, transfer, email, SMS, Telegram message, or physical NFC
operation was initiated by the recording/fixture scripts. No Production access,
secret/configuration changes, publishing, or application behavior changes.
`);
console.log(`MP4 export complete: ${(elapsed / 1000).toFixed(1)} seconds; captioned real application footage.`);
execFileSync('chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--no-pdf-header-footer', `--user-data-dir=/tmp/educore-demo-pdf-${Date.now()}`,
  `--print-to-pdf=${resolve(root, 'Demo-Report-Card.pdf')}`,
  `file://${resolve(root, 'actual-app-report.html')}`],
{ stdio: 'ignore', timeout: 60000 });
const pdf = await readFile(`${root}/Demo-Report-Card.pdf`);
if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('Actual app report export is not a PDF');
console.log('Actual app-generated report-card print document exported as PDF.');
