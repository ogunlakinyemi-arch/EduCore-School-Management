import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { currentNfcStudentRecordQuery } from "./attendance";

describe("NFC current student record selector against PostgreSQL", () => {
  beforeAll(async () => {
    const serverCheck = await pool.query(
      `SELECT current_database() AS database_name, inet_server_addr() AS tcp_address,
        current_setting('data_directory') AS data_directory,
        current_setting('unix_socket_directories') AS socket_directories`,
    );
    const localCluster = "/tmp/finance-ledger.";
    if (serverCheck.rows[0]?.database_name !== "postgres"
        || serverCheck.rows[0]?.tcp_address !== null
        || !String(serverCheck.rows[0]?.data_directory).startsWith(localCluster)
        || !String(serverCheck.rows[0]?.socket_directories).startsWith(localCluster)) {
      throw new Error("Refusing NFC current-record integration test outside the local disposable PostgreSQL database");
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns the same student's updated current class and section while the NFC identity is unchanged", async () => {
    const readCurrentRecord = (currentAssignmentId: number) => pool.query(
      `WITH students(id,school_id,first_name,middle_name,last_name,status) AS (
         VALUES (501,10,'Tomi'::text,NULL::text,'Adeyemi'::text,'ACTIVE'::text)
       ), school_classes(id,school_id,name) AS (
         VALUES (201,10,'JSS1'::text),(202,10,'JSS2'::text)
       ), academic_sessions(id,school_id,name,status,is_current) AS (
         VALUES (301,10,'2025/2026'::text,'ACTIVE'::text,true)
       ), academic_terms(id,school_id,academic_session_id,name,start_date,status,is_current) AS (
         VALUES (401,10,301,'First Term'::text,DATE '2025-09-01','ACTIVE'::text,true)
       ), student_class_assignments(
         id,school_id,student_id,academic_session_id,academic_term_id,school_class_id,
         section,status,is_current,created_at
       ) AS (
         VALUES
           (5010,10,501,301,401,201,'A'::text,'ACTIVE'::text,${currentAssignmentId === 5010},TIMESTAMPTZ '2025-09-01T08:00:00Z'),
           (5020,10,501,301,401,202,'B'::text,'ACTIVE'::text,${currentAssignmentId === 5020},TIMESTAMPTZ '2025-09-03T08:00:00Z')
       )
       ${currentNfcStudentRecordQuery}`,
      [10, 501],
    );

    const beforeTransfer = await readCurrentRecord(5010);
    const afterTransfer = await readCurrentRecord(5020);

    expect(beforeTransfer.rows[0]).toEqual({
      studentId: 501,
      studentName: "Tomi Adeyemi",
      className: "JSS1",
      section: "A",
      academicSession: "2025/2026",
      term: "First Term",
    });
    expect(afterTransfer.rows[0]).toEqual({
      studentId: 501,
      studentName: "Tomi Adeyemi",
      className: "JSS2",
      section: "B",
      academicSession: "2025/2026",
      term: "First Term",
    });
  });
});