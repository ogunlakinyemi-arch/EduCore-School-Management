import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

type DbClient = {
  query: (text: string, values?: unknown[]) => Promise<any>;
};

async function seedPartnerContext(client: DbClient, suffix: string) {
  const user = await client.query(
    `INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id`,
    [`phase4-${suffix}`, `phase4-${suffix}@example.test`],
  );
  const partner = await client.query(
    `INSERT INTO partner_profiles(user_id,partner_code,type,full_name,email,status)
     VALUES($1,$2,'INDIVIDUAL','Phase Four Partner',$3,'ACTIVE') RETURNING id`,
    [user.rows[0].id, `P4-${suffix}`, `phase4-${suffix}@example.test`],
  );
  const link = await client.query(
    `INSERT INTO partner_referral_links(partner_profile_id,token_hash,status,created_by)
     VALUES($1,$2,'ACTIVE',$3) RETURNING id`,
    [partner.rows[0].id, crypto.createHash("sha256").update(`ref-${suffix}`).digest("hex"), user.rows[0].id],
  );
  return { userId: user.rows[0].id, partnerId: partner.rows[0].id, linkId: link.rows[0].id };
}

describe("Phase 4 partner security and integrity", () => {
  it("stores only an invitation hash and consumes it exactly once", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const context = await seedPartnerContext(client, "invitation");
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const invitation = await client.query(
        `INSERT INTO partner_invitations(partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
         VALUES($1,'phase4-invitation@example.test',$2,'ACTIVE',NOW()+INTERVAL '1 day',$3)
         RETURNING id,token_hash`,
        [context.partnerId, tokenHash, context.userId],
      );
      expect(invitation.rows[0].token_hash).toBe(tokenHash);
      expect(invitation.rows[0].token_hash).not.toContain(rawToken);

      const first = await client.query(
        `UPDATE partner_invitations SET status='ACCEPTED',redeemed_at=NOW()
         WHERE id=$1 AND token_hash=$2 AND status='ACTIVE' RETURNING id`,
        [invitation.rows[0].id, tokenHash],
      );
      const second = await client.query(
        `UPDATE partner_invitations SET status='ACCEPTED',redeemed_at=NOW()
         WHERE id=$1 AND token_hash=$2 AND status='ACTIVE' RETURNING id`,
        [invitation.rows[0].id, tokenHash],
      );
      expect(first.rowCount).toBe(1);
      expect(second.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps referral links reusable across multiple new schools", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const context = await seedPartnerContext(client, "reusable");
      for (const code of ["P4-REF-A", "P4-REF-B"]) {
        const school = await client.query(
          `INSERT INTO schools(code,name,city,state) VALUES($1,$2,'Lagos','Lagos') RETURNING id`,
          [code, `${code} School`],
        );
        await client.query(
          `INSERT INTO school_partner_attributions
            (school_id,partner_profile_id,referral_link_id,source,status,is_current)
           VALUES($1,$2,$3,'REFERRAL','ACTIVE',true)`,
          [school.rows[0].id, context.partnerId, context.linkId],
        );
      }
      const result = await client.query(
        `SELECT l.status,count(a.id)::int AS uses
         FROM partner_referral_links l
         LEFT JOIN school_partner_attributions a ON a.referral_link_id=l.id
         WHERE l.id=$1 GROUP BY l.status`,
        [context.linkId],
      );
      expect(result.rows[0]).toEqual({ status: "ACTIVE", uses: 2 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("prevents silent replacement of a current school attribution", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await seedPartnerContext(client, "owner-a");
      const second = await seedPartnerContext(client, "owner-b");
      const school = await client.query(
        `INSERT INTO schools(code,name,city,state)
         VALUES('P4-CONFLICT','Conflict School','Lagos','Lagos') RETURNING id`,
      );
      await client.query(
        `INSERT INTO school_partner_attributions
          (school_id,partner_profile_id,referral_link_id,source,status,is_current)
         VALUES($1,$2,$3,'REFERRAL','ACTIVE',true)`,
        [school.rows[0].id, first.partnerId, first.linkId],
      );
      await expect(client.query(
        `INSERT INTO school_partner_attributions
          (school_id,partner_profile_id,referral_link_id,source,status,is_current)
         VALUES($1,$2,$3,'REFERRAL','ACTIVE',true)`,
        [school.rows[0].id, second.partnerId, second.linkId],
      )).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces balanced allocation snapshots and one commission per subscription term", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const context = await seedPartnerContext(client, "commission");
      const school = await client.query(
        `INSERT INTO schools(code,name,city,state)
         VALUES('P4-COMMISSION','Commission School','Lagos','Lagos') RETURNING id`,
      );
      const student = await client.query(
        `INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section)
         VALUES($1,'P4-STUDENT','Phase','Four','Other','JSS 1','A') RETURNING id`,
        [school.rows[0].id],
      );
      const subscription = await client.query(
        `INSERT INTO subscriptions(school_id,student_id,term,expires_at)
         VALUES($1,$2,'First Term',NOW()+INTERVAL '90 days') RETURNING id`,
        [school.rows[0].id, student.rows[0].id],
      );
      const rule = await client.query(
        `INSERT INTO commission_rules(name,allocation_total,partner_amount,school_amount,edupulse_amount)
         VALUES('Phase 4 Rule',5000,100,2000,2900) RETURNING id`,
      );
      await client.query(
        `UPDATE subscriptions SET partner_profile_id=$1,partner_share=100,school_share=2000,
          edupulse_share=2900,allocation_snapshot='{"rule":"phase4"}'::jsonb WHERE id=$2`,
        [context.partnerId, subscription.rows[0].id],
      );
      await client.query(
        `INSERT INTO commission_ledger
          (partner_profile_id,school_id,student_id,subscription_id,commission_rule_id,term,rate,amount)
         VALUES($1,$2,$3,$4,$5,'First Term',100,100)`,
        [context.partnerId, school.rows[0].id, student.rows[0].id, subscription.rows[0].id, rule.rows[0].id],
      );
      await expect(client.query(
        `INSERT INTO commission_ledger
          (partner_profile_id,school_id,student_id,subscription_id,commission_rule_id,term,rate,amount)
         VALUES($1,$2,$3,$4,$5,'First Term',100,100)`,
        [context.partnerId, school.rows[0].id, student.rows[0].id, subscription.rows[0].id, rule.rows[0].id],
      )).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});