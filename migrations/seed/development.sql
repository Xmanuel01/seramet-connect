-- Explicit development-only seed. Never run this file as part of production migrations.
INSERT INTO tenants
  (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
VALUES
  ('tenant-development','development-restaurant','Development Restaurant Ltd','Development Restaurant',
   'KES','Africa/Nairobi','en-KE',1,
   '{"id":"tenant-development","slug":"development-restaurant","legalName":"Development Restaurant Ltd","tradingName":"Development Restaurant","active":true,"defaultCurrency":"KES","timezone":"Africa/Nairobi","locale":"en-KE","countryCode":"KE","createdAt":"2026-08-30T00:00:00.000Z","updatedAt":"2026-08-30T00:00:00.000Z"}',
   '2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z');
INSERT INTO branches
  (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
VALUES
  ('tenant-development','branch-development','DEV','Development Branch','Africa/Nairobi',240,1,
   '{"id":"branch-development","tenantId":"tenant-development","code":"DEV","name":"Development Branch","address":"","phone":"","email":"","timezone":"Africa/Nairobi","currency":"KES","active":true,"metadata":{}}');
INSERT INTO roles (tenant_id,id,code,name,active,payload_json)
VALUES ('tenant-development','role-development-admin','DEVELOPMENT_ADMIN','Development Administrator',1,
  '{"id":"role-development-admin","tenantId":"tenant-development","code":"DEVELOPMENT_ADMIN","name":"Development Administrator","active":true,"permissions":[]}');
INSERT INTO users (tenant_id,id,email,name,active,payload_json,created_at,updated_at)
VALUES ('tenant-development','user-development-admin','developer@localhost','Development Administrator',1,'{}',
  '2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z');
INSERT INTO user_roles VALUES ('tenant-development','user-development-admin','role-development-admin');
INSERT INTO user_branches VALUES ('tenant-development','user-development-admin','branch-development');
