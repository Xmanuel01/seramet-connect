-- Explicit development-only onboarding seed. Never run as a production migration.
INSERT INTO permissions (code,description) VALUES
  ('setup.view','View setup and readiness'),
  ('setup.manage','Manage setup configuration'),
  ('setup.import','Preview and commit setup imports'),
  ('setup.opening_stock','Prepare opening stock'),
  ('setup.opening_stock.approve','Approve and post opening stock'),
  ('setup.accounting.manage','Manage setup accounting configuration'),
  ('setup.go_live.approve','Approve setup go-live state'),
  ('setup.go_live.override','Override eligible readiness blockers'),
  ('setup.export','Export tenant data'),
  ('setup.entitlements.manage','Manage entitlements and lifecycle'),
  ('setup.demo.reset','Reset explicit demo tenants'),
  ('setup.diagnostics.view','View redacted support diagnostics')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions WHERE code LIKE 'setup.%'
ON CONFLICT DO NOTHING;

-- Keep the authoritative development role aligned with the configured demo manager role.
-- Platform tenant provisioning and organisation ownership remain separately privileged.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions
WHERE code NOT IN ('platform.tenants.provision','settings.organisation.manage')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_onboarding_profiles
  (tenant_id,country_code,accounting_mode,tax_configuration_reference,logo_asset_reference,
   default_document_footer,fiscal_settings_json,contact_json,legal_identifiers_json,
   document_branding_json,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,
   updated_by,updated_at)
VALUES
  ('tenant-demo-mona','KE','PERPETUAL',NULL,NULL,'Thank you for your business!',
   '{}','{}','{}','{}','SETUP',1,1,'system:development-seed',CURRENT_TIMESTAMP,
   'system:development-seed',CURRENT_TIMESTAMP);

INSERT INTO branch_operating_profiles
  (tenant_id,branch_id,accounting_mode_override,negative_stock_policy,operating_hours_json,
   service_modes_json,required_device_roles_json,payments_required,inventory_enabled,
   recipes_required,printing_required,kds_required,created_by,created_at,updated_by,updated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',NULL,'MANAGER_OVERRIDE','{}',
   '["DINE_IN","TAKEAWAY","DELIVERY"]','["FRONT","KITCHEN"]',1,1,0,1,1,
   'system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','branch-demo-ngong-road',NULL,'ALLOW_WITH_ALERT','{}',
   '["DINE_IN","TAKEAWAY"]','["FRONT"]',1,0,0,1,0,
   'system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP);

INSERT INTO setup_section_weights
  (tenant_id,section_key,weight_bps,updated_by,updated_at)
VALUES
  ('tenant-demo-mona','BUSINESS_PROFILE',800,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','BRANCHES',700,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','USERS_ROLES',600,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','MENU',800,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','INVENTORY',700,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','RECIPES_UOM',700,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','SUPPLIERS',300,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','ACCOUNTING',900,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','TAX_SERVICE',500,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','PAYMENTS',700,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','DELIVERY_INTEGRATIONS',300,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','KITCHEN_STATIONS',500,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','PRINTERS_DEVICES',600,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','DOCUMENTS',500,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','OPENING_STOCK',600,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','TESTING',500,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','READINESS',200,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','GO_LIVE',200,'system:development-seed',CURRENT_TIMESTAMP);

INSERT INTO menu_catalog_items
  (tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,
   service_charge_applicable,station_id,sellable,active,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','menu-demo-biryani','MENU-001','MENU-001','Chicken Biryani','MAIN_MEALS',
   'Configured demonstration menu item',100000,'KES',0,'station-demo-main',1,1,'{"demo":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','menu-demo-stew','MENU-002','MENU-002','Mbuzi Stew and Chapati','MAIN_MEALS',
   'Configured demonstration menu item',95000,'KES',0,'station-demo-main',1,1,'{"demo":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','menu-demo-colada','MENU-003','MENU-003','Pina Colada','BEVERAGES',
   'Configured demonstration menu item',70000,'KES',0,NULL,1,1,'{"demo":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','menu-demo-juice','MENU-004','MENU-004','Passion Juice','BEVERAGES',
   'Configured demonstration menu item',40000,'KES',0,NULL,1,1,'{"demo":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO payment_methods
  (tenant_id,id,code,category,active,payload_json)
VALUES ('tenant-demo-mona','payment-demo-cash','CASH','CASH',1,'{"displayName":"Cash","demo":true}');

INSERT INTO document_templates
  (tenant_id,id,branch_id,document_type,layout_version,active,payload_json)
VALUES
  ('tenant-demo-mona','template-demo-kot',NULL,'KOT','seramet-approved-v1',1,'{"demo":true,"width":"80mm"}'),
  ('tenant-demo-mona','template-demo-bill',NULL,'BILL','seramet-approved-v1',1,'{"demo":true,"width":"80mm"}'),
  ('tenant-demo-mona','template-demo-receipt',NULL,'RECEIPT','seramet-approved-v1',1,'{"demo":true,"width":"80mm"}'),
  ('tenant-demo-mona','template-demo-invoice',NULL,'INVOICE','seramet-approved-v1',1,'{"demo":true,"width":"A4"}');

INSERT INTO hardware_devices
  (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json)
VALUES
  ('tenant-demo-mona','device-demo-front','branch-demo-westlands','PRINTER','Front printer',
   'PENDING','system:development-seed',CURRENT_TIMESTAMP,'{"demo":true,"role":"FRONT"}');
