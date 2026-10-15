BEGIN;
INSERT INTO schools(id,code,name,city,state,status) VALUES(1,'SYNTHETIC_NFC_HW','SYNTHETIC NFC HARDWARE TEST ONLY','Test City','Test State','active');
INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section,status) VALUES(1,1,'SYNTHETIC0001','Synthetic','Test Student','MALE','TEST1','A','ACTIVE');
INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current) VALUES(1,1,'SYNTHETIC TEST SESSION',CURRENT_DATE-1,CURRENT_DATE+365,'ACTIVE',true);
INSERT INTO academic_terms(id,school_id,academic_session_id,name,start_date,end_date,status,is_current) VALUES(1,1,1,'SYNTHETIC TEST TERM',CURRENT_DATE-1,CURRENT_DATE+100,'ACTIVE',true);
INSERT INTO school_classes(id,school_id,name,section) VALUES(1,1,'TEST1','A');
INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,is_current,start_date,created_at) VALUES(1,1,1,1,1,'A','ACTIVE',true,CURRENT_DATE-1,NOW()-INTERVAL '2 days');
INSERT INTO nfc_cards(id,school_id,student_id,uid,status) VALUES(1,1,1,'A1B2C3D4','ACTIVE');
INSERT INTO platform_devices(id,serial_number,name,device_type,school_id,status,configuration_status) VALUES
 (1,'SYNTHETIC-HW-ENTRY','MAIN GATE synthetic ENTRY','NFC',1,'ACTIVE','CONFIGURED'),
 (2,'SYNTHETIC-HW-EXIT','MAIN GATE synthetic EXIT','NFC',1,'ACTIVE','CONFIGURED');
INSERT INTO device_school_bindings(device_id,school_id) VALUES(1,1),(2,1);
INSERT INTO device_credentials(school_id,device_id,credential_identifier,secret_hash,status) VALUES
 (1,1,'synthetic_hw_entry','{{ENTRY_HASH}}','ACTIVE'),
 (1,2,'synthetic_hw_exit','{{EXIT_HASH}}','ACTIVE');
INSERT INTO audit_logs("user",role,school_id,action,module,record_id,metadata) VALUES
 ('Synthetic hardware fixture','PLATFORM_OWNER',1,'Configured NFC terminal direction','Devices',1,'{"terminalDirection":"ENTRY","schoolId":1}'),
 ('Synthetic hardware fixture','PLATFORM_OWNER',1,'Configured NFC terminal direction','Devices',2,'{"terminalDirection":"EXIT","schoolId":1}');
COMMIT;
