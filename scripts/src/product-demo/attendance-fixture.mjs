import { createRequire } from 'node:module';
import { fixture } from './access.mjs';
const { Client } = createRequire(new URL('../../../lib/db/package.json', import.meta.url))('pg');
if (process.env.REPLIT_DEPLOYMENT || !process.env.REPLIT_DEV_DOMAIN) throw Error('Development only');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const r = (await db.query(`SELECT current_database() db,pg_postmaster_start_time() started,
    inet_server_addr() IS NULL local`)).rows[0];
  if (r.db !== 'heliumdb' || !r.local || new Date(r.started).toISOString() !== '2026-10-29T20:42:18.161Z') throw Error('Target changed');
  await db.query('BEGIN');
  const s = (await db.query(`SELECT id FROM schools WHERE id=$1 AND code=$2`,
    [fixture.schoolId, fixture.label])).rows[0];
  if (!s) throw Error('Demo ownership mismatch');
  await db.query(`UPDATE attendance_events SET event_type='SCHOOL_ENTRY'
    WHERE school_id=$1 AND reason='Fictional product demonstration' AND event_type='TAG_IN'`,
  [fixture.schoolId]);
  for (const student of fixture.students) await db.query(`INSERT INTO attendance_events
    (school_id,student_id,identification_method,event_type,result,event_date,occurred_at,academic_session_id,
    academic_term_id,school_class_id,class_name_snapshot,section_snapshot,reason,actor_user_id,dedupe_key)
    VALUES($1,$2,'MANUAL','CLASSROOM_ENTRY','SUCCESS',CURRENT_DATE,CURRENT_DATE+interval '8 hours',
    $3,$4,$5,'JSS1','A','Fictional product demonstration',$6,$7) ON CONFLICT DO NOTHING`,
  [fixture.schoolId, student.id, fixture.sessionId, fixture.termId, fixture.classId,
    fixture.actors.teacher.userId, `${fixture.label}-${student.id}-class`]);
  await db.query('COMMIT');
  console.log('Only the newly authorized fictional attendance fixture was completed.');
} catch (e) { await db.query('ROLLBACK'); throw e; }
finally { await db.end(); }
