-- Incremental, non-destructive Development-ready school transportation schema.
-- Student identity, attendance, academic periods and every transportation fee
-- continue to use the existing school/student/employee/Finance records.

CREATE TABLE transport_buses (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name text NOT NULL,
  registration_number text NOT NULL,
  make text,
  capacity integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_buses_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT transport_buses_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  CONSTRAINT transport_buses_registration_check CHECK (length(btrim(registration_number)) BETWEEN 3 AND 30),
  CONSTRAINT transport_buses_make_check CHECK (make IS NULL OR length(btrim(make)) <= 100),
  CONSTRAINT transport_buses_capacity_check CHECK (capacity BETWEEN 1 AND 250),
  CONSTRAINT transport_buses_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE'))
);
CREATE UNIQUE INDEX transport_buses_school_registration_unique
  ON transport_buses(school_id, lower(btrim(registration_number)));
CREATE INDEX transport_buses_school_status_idx ON transport_buses(school_id, status);

CREATE TABLE transport_routes (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  bus_id integer NOT NULL,
  driver_employee_id integer NOT NULL,
  name text NOT NULL,
  weekdays text[] NOT NULL,
  departure_time text NOT NULL,
  arrival_time text NOT NULL,
  fare_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_routes_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT transport_routes_bus_school_fk
    FOREIGN KEY (bus_id, school_id) REFERENCES transport_buses(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_routes_driver_school_fk
    FOREIGN KEY (driver_employee_id, school_id) REFERENCES employees(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_routes_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT transport_routes_weekdays_check CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::text[]
  ),
  CONSTRAINT transport_routes_departure_time_check CHECK (departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT transport_routes_arrival_time_check CHECK (arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT transport_routes_schedule_order_check CHECK (arrival_time > departure_time),
  CONSTRAINT transport_routes_fare_currency_check CHECK (fare_minor >= 0 AND currency = 'NGN'),
  CONSTRAINT transport_routes_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX transport_routes_school_bus_status_idx ON transport_routes(school_id, bus_id, status);
CREATE INDEX transport_routes_school_driver_idx ON transport_routes(school_id, driver_employee_id, status);

CREATE TABLE transport_route_stops (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  route_id integer NOT NULL,
  name text NOT NULL,
  stop_type text NOT NULL,
  sequence integer NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_route_stops_id_route_school_unique UNIQUE (id, route_id, school_id),
  CONSTRAINT transport_route_stops_route_school_fk
    FOREIGN KEY (route_id, school_id) REFERENCES transport_routes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_route_stops_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT transport_route_stops_type_check CHECK (stop_type IN ('PICKUP', 'DROPOFF', 'BOTH')),
  CONSTRAINT transport_route_stops_sequence_check CHECK (sequence > 0),
  CONSTRAINT transport_route_stops_notes_check CHECK (notes IS NULL OR length(notes) <= 500),
  CONSTRAINT transport_route_stops_route_sequence_unique UNIQUE (route_id, sequence)
);
CREATE INDEX transport_route_stops_school_route_active_idx
  ON transport_route_stops(school_id, route_id, is_active);

CREATE TABLE transport_student_assignments (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  route_id integer NOT NULL,
  pickup_stop_id integer NOT NULL,
  dropoff_stop_id integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_date date NOT NULL,
  end_date date,
  reason text NOT NULL,
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_student_assignments_id_school_unique UNIQUE(id, school_id),
  CONSTRAINT transport_student_assignments_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_student_assignments_route_school_fk
    FOREIGN KEY (route_id, school_id) REFERENCES transport_routes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_student_assignments_pickup_route_school_fk
    FOREIGN KEY (pickup_stop_id, route_id, school_id) REFERENCES transport_route_stops(id, route_id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_student_assignments_dropoff_route_school_fk
    FOREIGN KEY (dropoff_stop_id, route_id, school_id) REFERENCES transport_route_stops(id, route_id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_student_assignments_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  CONSTRAINT transport_student_assignments_stops_check CHECK (pickup_stop_id <> dropoff_stop_id),
  CONSTRAINT transport_student_assignments_dates_check CHECK (end_date IS NULL OR end_date >= effective_date),
  CONSTRAINT transport_student_assignments_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 500)
);
CREATE UNIQUE INDEX transport_student_assignments_one_current_per_student
  ON transport_student_assignments(student_id) WHERE status IN ('ACTIVE', 'SUSPENDED');
CREATE INDEX transport_student_assignments_school_status_student_idx
  ON transport_student_assignments(school_id, status, student_id);
CREATE INDEX transport_student_assignments_route_status_idx
  ON transport_student_assignments(school_id, route_id, status);

CREATE TABLE transport_route_staff (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  route_id integer NOT NULL,
  employee_id integer NOT NULL,
  role text NOT NULL DEFAULT 'ACCOMPANIER',
  is_active boolean NOT NULL DEFAULT true,
  assigned_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_route_staff_id_school_unique UNIQUE(id, school_id),
  CONSTRAINT transport_route_staff_route_school_fk
    FOREIGN KEY (route_id, school_id) REFERENCES transport_routes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_route_staff_employee_school_fk
    FOREIGN KEY (employee_id, school_id) REFERENCES employees(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_route_staff_role_check CHECK (role IN ('TEACHER', 'STAFF', 'ACCOMPANIER'))
);
CREATE UNIQUE INDEX transport_route_staff_route_employee_active_unique
  ON transport_route_staff(route_id, employee_id) WHERE is_active;
CREATE INDEX transport_route_staff_school_route_active_idx
  ON transport_route_staff(school_id, route_id, is_active);

CREATE TABLE transport_parent_requests (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  parent_id integer NOT NULL,
  assignment_id integer,
  request_type text NOT NULL,
  request_date timestamptz NOT NULL DEFAULT now(),
  effective_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  school_action text,
  school_note text,
  reviewed_by integer REFERENCES app_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_parent_requests_id_school_unique UNIQUE(id, school_id),
  CONSTRAINT transport_parent_requests_student_school_fk
    FOREIGN KEY(student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_parent_requests_active_relationship_fk
    FOREIGN KEY(parent_id, student_id) REFERENCES parent_student_relationships(parent_id, student_id) ON DELETE RESTRICT,
  CONSTRAINT transport_parent_requests_assignment_school_fk
    FOREIGN KEY(assignment_id, school_id) REFERENCES transport_student_assignments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_parent_requests_type_check CHECK (request_type IN ('ACTIVATE', 'DEACTIVATE')),
  CONSTRAINT transport_parent_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT transport_parent_requests_action_check CHECK (school_action IS NULL OR school_action IN ('ACTIVATE','SUSPEND','DEACTIVATE','NO_CHANGE')),
  CONSTRAINT transport_parent_requests_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT transport_parent_requests_school_note_check CHECK (school_note IS NULL OR length(btrim(school_note)) BETWEEN 3 AND 1000),
  CONSTRAINT transport_parent_requests_review_check CHECK (
    (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX transport_parent_requests_one_pending_student
  ON transport_parent_requests(student_id) WHERE status = 'PENDING';
CREATE INDEX transport_parent_requests_school_status_created_idx
  ON transport_parent_requests(school_id, status, created_at);
CREATE INDEX transport_parent_requests_parent_student_created_idx
  ON transport_parent_requests(parent_id, student_id, created_at);

CREATE TABLE transport_fee_invoices (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  assignment_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  fee_category_id integer,
  amount_minor integer NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  fee_invoice_id integer,
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_fee_invoices_id_school_unique UNIQUE(id, school_id),
  CONSTRAINT transport_fee_invoices_assignment_term_unique UNIQUE(assignment_id, academic_term_id),
  CONSTRAINT transport_fee_invoices_fee_invoice_unique UNIQUE(fee_invoice_id),
  CONSTRAINT transport_fee_invoices_assignment_school_fk
    FOREIGN KEY(assignment_id, school_id) REFERENCES transport_student_assignments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_fee_invoices_session_school_fk
    FOREIGN KEY(academic_session_id, school_id) REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_fee_invoices_term_school_fk
    FOREIGN KEY(academic_term_id, school_id) REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_fee_invoices_category_school_fk
    FOREIGN KEY(fee_category_id, school_id) REFERENCES fee_categories(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_fee_invoices_finance_invoice_school_fk
    FOREIGN KEY(fee_invoice_id, school_id) REFERENCES fee_invoices(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_fee_invoices_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT transport_fee_invoices_status_check CHECK (status IN ('PLANNED','INVOICED','CANCELLED')),
  CONSTRAINT transport_fee_invoices_invoice_state_check CHECK (
    (status = 'INVOICED' AND fee_invoice_id IS NOT NULL AND amount_minor > 0)
    OR (status IN ('PLANNED','CANCELLED') AND fee_invoice_id IS NULL)
  ),
  CONSTRAINT transport_fee_invoices_category_check CHECK (amount_minor = 0 OR fee_category_id IS NOT NULL)
);
CREATE INDEX transport_fee_invoices_school_term_idx ON transport_fee_invoices(school_id, academic_term_id);

CREATE TABLE transport_school_policies (
  school_id integer PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  payment_required boolean NOT NULL DEFAULT false,
  suspend_when_overdue boolean NOT NULL DEFAULT false,
  updated_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_school_policies_payment_gate_check CHECK (NOT suspend_when_overdue OR payment_required)
);

CREATE TABLE transport_history (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  assignment_id integer,
  route_id integer,
  bus_id integer,
  request_id integer,
  route_staff_id integer,
  student_id integer,
  event_type text NOT NULL,
  effective_date date NOT NULL,
  reason text NOT NULL,
  actor_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_history_assignment_school_fk
    FOREIGN KEY(assignment_id, school_id) REFERENCES transport_student_assignments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_route_school_fk
    FOREIGN KEY(route_id, school_id) REFERENCES transport_routes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_bus_school_fk
    FOREIGN KEY(bus_id, school_id) REFERENCES transport_buses(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_request_school_fk
    FOREIGN KEY(request_id, school_id) REFERENCES transport_parent_requests(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_route_staff_school_fk
    FOREIGN KEY(route_staff_id, school_id) REFERENCES transport_route_staff(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_student_school_fk
    FOREIGN KEY(student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT transport_history_one_event_entity_check CHECK (
    num_nonnulls(assignment_id, route_id, bus_id, request_id, route_staff_id) = 1
  ),
  CONSTRAINT transport_history_event_reason_check CHECK (
    length(btrim(event_type)) BETWEEN 3 AND 80 AND length(btrim(reason)) BETWEEN 3 AND 1000
  )
);
CREATE INDEX transport_history_school_assignment_created_idx
  ON transport_history(school_id, assignment_id, created_at);
CREATE INDEX transport_history_school_student_created_idx
  ON transport_history(school_id, student_id, created_at);
CREATE INDEX transport_history_school_request_created_idx
  ON transport_history(school_id, request_id, created_at);
CREATE INDEX transport_history_school_route_created_idx
  ON transport_history(school_id, route_id, created_at);
