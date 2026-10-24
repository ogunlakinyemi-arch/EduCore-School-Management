-- Minimal fictional baseline. Only loaded after the runner verifies a fresh,
-- private socket-only cluster. Application migrations themselves are replayed.
CREATE TABLE app_users(id serial PRIMARY KEY,clerk_user_id text NOT NULL UNIQUE,email text NOT NULL,
 first_name text,last_name text,phone text,status text NOT NULL DEFAULT 'ACTIVE',updated_at timestamptz DEFAULT now());
CREATE TABLE schools(id serial PRIMARY KEY,code text UNIQUE,name text,city text,state text,status text DEFAULT 'active');
CREATE TABLE school_memberships(id serial PRIMARY KEY,user_id int NOT NULL REFERENCES app_users,
 school_id int REFERENCES schools,role text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE');
CREATE TABLE students(id serial PRIMARY KEY,user_id int REFERENCES app_users,school_id int REFERENCES schools,email text);
CREATE TABLE parents(id serial PRIMARY KEY,user_id int REFERENCES app_users,school_id int REFERENCES schools,email text);
CREATE TABLE employees(id serial PRIMARY KEY,user_id int REFERENCES app_users,school_id int REFERENCES schools,email text,
 employee_type text,employment_status text DEFAULT 'ACTIVE');
CREATE TABLE parent_student_relationships(id serial PRIMARY KEY,parent_id int REFERENCES parents,student_id int REFERENCES students);
CREATE TABLE platform_company_employees(id serial PRIMARY KEY,email text NOT NULL);
CREATE TABLE partner_profiles(id serial PRIMARY KEY,user_id int UNIQUE REFERENCES app_users,partner_code text UNIQUE,
 type text,full_name text,business_name text,email text,phone text,address text,state text,status text DEFAULT 'ACTIVE',
 registered_at timestamptz,activated_at timestamptz,created_by int REFERENCES app_users);
CREATE TABLE partner_profile_users(partner_profile_id int REFERENCES partner_profiles,user_id int REFERENCES app_users,
 role text,status text DEFAULT 'ACTIVE');
CREATE TABLE partner_invitations(id serial PRIMARY KEY,partner_profile_id int REFERENCES partner_profiles,
 invited_email text,status text,token_hash text);
CREATE TABLE partner_referral_links(id serial PRIMARY KEY,partner_profile_id int REFERENCES partner_profiles,token_hash text,status text);
CREATE TABLE school_partner_attributions(id serial PRIMARY KEY,school_id int REFERENCES schools,partner_profile_id int REFERENCES partner_profiles,
 referral_link_id int REFERENCES partner_referral_links,source text,status text,is_current boolean,created_by int REFERENCES app_users);
CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text NOT NULL,role text NOT NULL,actor_user_id int REFERENCES app_users,
 clerk_user_id text,school_id int REFERENCES schools,action text NOT NULL,module text NOT NULL,record_id int,
 timestamp timestamptz NOT NULL DEFAULT now(),severity text DEFAULT 'info',event_type text,result text,metadata jsonb);
CREATE TABLE platform_devices(id serial PRIMARY KEY,school_id int REFERENCES schools);
CREATE TABLE device_credentials(id serial PRIMARY KEY,device_id int REFERENCES platform_devices,school_id int REFERENCES schools);
CREATE TABLE device_assignment_history(id serial PRIMARY KEY,device_id int REFERENCES platform_devices,school_id int REFERENCES schools);
CREATE TABLE nfc_cards(id serial PRIMARY KEY,school_id int REFERENCES schools,student_id int REFERENCES students,uid text);
CREATE TABLE fee_payments(id serial PRIMARY KEY,school_id int REFERENCES schools,student_id int REFERENCES students,
 partner_profile_id int REFERENCES partner_profiles,recorded_by int REFERENCES app_users,amount int);
