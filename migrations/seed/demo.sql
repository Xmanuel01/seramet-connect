-- Optional demonstration seed. It is isolated from production migrations.
INSERT INTO tenants
  (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','mona-swahili-demo','Mona Swahili Restaurant Limited','Mona Swahili',
   'KES','Africa/Nairobi','en-KE',1,
   '{"id":"tenant-demo-mona","slug":"mona-swahili-demo","legalName":"Mona Swahili Restaurant Limited","tradingName":"Mona Swahili","active":true,"defaultCurrency":"KES","timezone":"Africa/Nairobi","locale":"en-KE","countryCode":"KE","createdAt":"2026-08-18T00:00:00.000Z","updatedAt":"2026-08-18T00:00:00.000Z"}',
   '2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z');
INSERT INTO brands (tenant_id,id,code,name,active,payload_json)
VALUES ('tenant-demo-mona','brand-demo-mona','MONA','Mona Swahili',1,
  '{"id":"brand-demo-mona","tenantId":"tenant-demo-mona","code":"MONA","name":"Mona Swahili","active":true}');
INSERT INTO branches
  (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
VALUES
  ('tenant-demo-mona','branch-demo-westlands','brand-demo-mona','WST','Westlands','Africa/Nairobi',240,1,
   '{"id":"branch-demo-westlands","tenantId":"tenant-demo-mona","brandId":"brand-demo-mona","code":"WST","name":"Westlands","address":"Kipro Centre, Sports Road","phone":"0719 427 919","email":"info@monaswahili.co.ke","timezone":"Africa/Nairobi","currency":"KES","active":true,"metadata":{}}'),
  ('tenant-demo-mona','branch-demo-ngong-road','brand-demo-mona','NGG','Ngong Road','Africa/Nairobi',240,1,
   '{"id":"branch-demo-ngong-road","tenantId":"tenant-demo-mona","brandId":"brand-demo-mona","code":"NGG","name":"Ngong Road","address":"Ngong Road Branch","phone":"0719 427 919","email":"info@monaswahili.co.ke","timezone":"Africa/Nairobi","currency":"KES","active":true,"metadata":{}}');
