-- Explicit development-only enterprise seed. Production migration 0013 is data-free.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions WHERE code LIKE 'enterprise.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES
  ('tenant-demo-mona','role-demo-branch-manager','scope.branches.all'),
  ('tenant-demo-mona','role-demo-branch-manager','branches.switch')
ON CONFLICT DO NOTHING;

INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES
  ('tenant-demo-mona','user-demo-emmanuel-obiambo','branch-demo-ngong-road')
ON CONFLICT DO NOTHING;

INSERT INTO legal_entities
  (tenant_id,id,code,legal_name,trading_name,country_code,base_currency,status,
   created_by,created_at,updated_by,updated_at)
VALUES
  ('tenant-demo-mona','legal-demo-corporate','CORPORATE','Configured Corporate Entity',
   'Configured Corporate Operations','KE','KES','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,
   'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','legal-demo-franchise','FRANCHISEE','Configured Franchise Entity',
   'Configured Franchise Operations','KE','KES','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,
   'system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_nodes
  (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,warehouse_id,
   status,effective_from,timezone,currency,created_by,created_at,updated_by,updated_at)
VALUES
  ('tenant-demo-mona','enterprise-demo-group','GROUP','GROUP','Restaurant Group',NULL,NULL,NULL,NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-corporate','LEGAL_ENTITY','CORPORATE','Corporate Entity','enterprise-demo-group','legal-demo-corporate',NULL,NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-brand','BRAND','BRAND','Primary Brand','enterprise-demo-corporate','legal-demo-corporate','brand-demo-mona',NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-region','REGION','REGION-01','Primary Region','enterprise-demo-brand','legal-demo-corporate','brand-demo-mona',NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-branch-west','BRANCH','BRANCH-01','Westlands','enterprise-demo-region','legal-demo-corporate','brand-demo-mona','branch-demo-westlands',NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-warehouse-west','WAREHOUSE','WAREHOUSE-01','Central Store','enterprise-demo-branch-west','legal-demo-corporate','brand-demo-mona',NULL,'warehouse-demo-westlands',
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-franchise','LEGAL_ENTITY','FRANCHISEE','Franchise Entity','enterprise-demo-group','legal-demo-franchise',NULL,NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-franchise-brand','BRAND','FRANCHISE-BRAND','Franchise Brand Operations','enterprise-demo-franchise','legal-demo-franchise','brand-demo-mona',NULL,NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','enterprise-demo-branch-ngong','BRANCH','BRANCH-02','Ngong Road','enterprise-demo-franchise-brand','legal-demo-franchise','brand-demo-mona','branch-demo-ngong-road',NULL,
   'ACTIVE','2026-01-01T00:00:00.000Z','Africa/Nairobi','KES','system:development-seed',CURRENT_TIMESTAMP,'system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth) VALUES
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-group',0),
  ('tenant-demo-mona','enterprise-demo-corporate','enterprise-demo-corporate',0),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-corporate',1),
  ('tenant-demo-mona','enterprise-demo-brand','enterprise-demo-brand',0),
  ('tenant-demo-mona','enterprise-demo-corporate','enterprise-demo-brand',1),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-brand',2),
  ('tenant-demo-mona','enterprise-demo-region','enterprise-demo-region',0),
  ('tenant-demo-mona','enterprise-demo-brand','enterprise-demo-region',1),
  ('tenant-demo-mona','enterprise-demo-corporate','enterprise-demo-region',2),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-region',3),
  ('tenant-demo-mona','enterprise-demo-branch-west','enterprise-demo-branch-west',0),
  ('tenant-demo-mona','enterprise-demo-region','enterprise-demo-branch-west',1),
  ('tenant-demo-mona','enterprise-demo-brand','enterprise-demo-branch-west',2),
  ('tenant-demo-mona','enterprise-demo-corporate','enterprise-demo-branch-west',3),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-branch-west',4),
  ('tenant-demo-mona','enterprise-demo-warehouse-west','enterprise-demo-warehouse-west',0),
  ('tenant-demo-mona','enterprise-demo-branch-west','enterprise-demo-warehouse-west',1),
  ('tenant-demo-mona','enterprise-demo-region','enterprise-demo-warehouse-west',2),
  ('tenant-demo-mona','enterprise-demo-brand','enterprise-demo-warehouse-west',3),
  ('tenant-demo-mona','enterprise-demo-corporate','enterprise-demo-warehouse-west',4),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-warehouse-west',5),
  ('tenant-demo-mona','enterprise-demo-franchise','enterprise-demo-franchise',0),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-franchise',1),
  ('tenant-demo-mona','enterprise-demo-franchise-brand','enterprise-demo-franchise-brand',0),
  ('tenant-demo-mona','enterprise-demo-franchise','enterprise-demo-franchise-brand',1),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-franchise-brand',2),
  ('tenant-demo-mona','enterprise-demo-branch-ngong','enterprise-demo-branch-ngong',0),
  ('tenant-demo-mona','enterprise-demo-franchise-brand','enterprise-demo-branch-ngong',1),
  ('tenant-demo-mona','enterprise-demo-franchise','enterprise-demo-branch-ngong',2),
  ('tenant-demo-mona','enterprise-demo-group','enterprise-demo-branch-ngong',3)
ON CONFLICT DO NOTHING;

INSERT INTO enterprise_role_assignments
  (tenant_id,id,user_id,role_id,scope_node_id,descend_to_children,effect,valid_from,granted_by,reason,created_at)
VALUES
  ('tenant-demo-mona','enterprise-assignment-demo-manager','user-demo-emmanuel-obiambo',
   'role-demo-branch-manager','enterprise-demo-group',1,'ALLOW','2026-01-01T00:00:00.000Z',
   'system:development-seed','Development enterprise access',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_policy_definitions
  (tenant_id,id,code,name,category,value_schema_json,sensitive,active,created_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','policy-demo-menu-price','MENU_PRICE:menu-demo-biryani','Menu price control','PRICE','{"type":"integer"}',0,1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-demo-supplier','PROCUREMENT.APPROVED_SUPPLIERS','Approved supplier governance','PROCUREMENT','{"type":"array"}',0,1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-demo-security','SECURITY.SESSION_POLICY','Session security policy','SECURITY','{"type":"object"}',1,1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_policy_assignments
  (tenant_id,id,policy_id,scope_node_id,value_json,state,minimum_value_minor,maximum_value_minor,
   approval_policy_json,effective_from,version,created_by,created_at)
VALUES
  ('tenant-demo-mona','policy-assignment-demo-price','policy-demo-menu-price','enterprise-demo-brand','100000',
   'ALLOWED_WITHIN_RANGE',90000,120000,'{}','2026-01-01T00:00:00.000Z',1,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-assignment-demo-supplier','policy-demo-supplier','enterprise-demo-group',
   '["supplier-demo-primary"]','LOCKED',NULL,NULL,'{}','2026-01-01T00:00:00.000Z',1,'system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-assignment-demo-security','policy-demo-security','enterprise-demo-group',
   '{"deviceTrustRequired":true}','LOCKED',NULL,NULL,'{}','2026-01-01T00:00:00.000Z',1,'system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_policy_versions
  (tenant_id,id,assignment_id,version,snapshot_json,snapshot_hash,created_by,created_at)
VALUES
  ('tenant-demo-mona','policy-version-demo-price','policy-assignment-demo-price',1,'{"state":"ALLOWED_WITHIN_RANGE","value":100000}','demo-policy-price-v1','system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-version-demo-supplier','policy-assignment-demo-supplier',1,'{"state":"LOCKED"}','demo-policy-supplier-v1','system:development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','policy-version-demo-security','policy-assignment-demo-security',1,'{"state":"LOCKED"}','demo-policy-security-v1','system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO branch_templates
  (tenant_id,id,code,name,brand_id,status,created_by,created_at,updated_at)
VALUES ('tenant-demo-mona','template-demo-enterprise','FULL_SERVICE','Full Service Branch','brand-demo-mona','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO branch_template_versions
  (tenant_id,id,template_id,version,configuration_json,configuration_hash,status,created_by,created_at)
VALUES ('tenant-demo-mona','template-version-demo-enterprise','template-demo-enterprise',1,
  '{"warehouses":["MAIN"],"stations":["KITCHEN"],"requiredSetup":["PAYMENTS","PRINTING","KDS"]}',
  'demo-enterprise-template-v1','PUBLISHED','system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO branch_template_assignments
  (tenant_id,id,branch_id,template_version_id,adoption_status,applied_by,applied_at,differences_json,blockers_json,updated_at)
VALUES
  ('tenant-demo-mona','template-assignment-demo-west','branch-demo-westlands','template-version-demo-enterprise','APPLIED','system:development-seed',CURRENT_TIMESTAMP,'[]','[]',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','template-assignment-demo-ngong','branch-demo-ngong-road','template-version-demo-enterprise','READY',NULL,NULL,'["KDS requirement pending review"]','[]',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO supplier_contracts
  (tenant_id,id,supplier_id,scope_node_id,contract_reference,inventory_item_id,purchase_unit_id,
   negotiated_price_minor,currency,minimum_quantity_micro,lead_time_days,effective_from,status,
   created_by,created_at,updated_at)
SELECT 'tenant-demo-mona','supplier-contract-demo','supplier-demo-primary','enterprise-demo-group',
  'DEMO-CONTRACT-01',si.inventory_item_id,si.purchase_unit_id,si.contract_price_minor,'KES',1000000,2,
  '2026-01-01T00:00:00.000Z','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM supplier_items si WHERE si.tenant_id='tenant-demo-mona' AND si.supplier_id='supplier-demo-primary'
LIMIT 1
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO franchise_relationships
  (tenant_id,id,franchisee_legal_entity_id,franchisor_legal_entity_id,brand_id,agreement_reference,
   effective_from,status,reporting_scope_json,created_by,created_at,updated_at)
VALUES ('tenant-demo-mona','franchise-demo-relationship','legal-demo-franchise','legal-demo-corporate',
  'brand-demo-mona','DEMO-AGREEMENT-01','2026-01-01T00:00:00.000Z','ACTIVE','{"customerData":"BRANCH_ONLY"}',
  'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO franchise_branch_assignments (tenant_id,franchise_relationship_id,branch_id)
VALUES ('tenant-demo-mona','franchise-demo-relationship','branch-demo-ngong-road')
ON CONFLICT DO NOTHING;

INSERT INTO franchise_fee_definitions
  (tenant_id,id,franchise_relationship_id,code,name,fee_type,basis_type,rate_bps,currency,
   exclusions_json,account_mapping_json,effective_from,active,created_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','franchise-fee-demo-royalty','franchise-demo-relationship','ROYALTY','Configured Royalty',
   'ROYALTY','NET_SALES',650,'KES','["TAX","CONFIRMED_REFUNDS"]','{}','2026-01-01T00:00:00.000Z',1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','franchise-fee-demo-marketing','franchise-demo-relationship','MARKETING','Configured Marketing Levy',
   'MARKETING_LEVY','NET_SALES',150,'KES','["TAX","CONFIRMED_REFUNDS"]','{}','2026-01-01T00:00:00.000Z',1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO franchise_compliance_results
  (tenant_id,id,franchise_relationship_id,branch_id,check_code,status,evidence_json,message,calculated_at)
VALUES
  ('tenant-demo-mona','compliance-demo-price','franchise-demo-relationship','branch-demo-ngong-road','PRICE_POLICY','COMPLIANT','{"source":"authoritative pricing"}','Branch pricing is within configured policy',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','compliance-demo-device','franchise-demo-relationship','branch-demo-ngong-road','REQUIRED_DEVICE','UNKNOWN','{}','Device evidence has not been verified',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO enterprise_readiness_results
  (tenant_id,id,scope_node_id,branch_id,check_code,status,severity,message,evidence_json,recommended_action,source,calculated_at)
VALUES
  ('tenant-demo-mona','readiness-demo-west','enterprise-demo-branch-west','branch-demo-westlands','SETUP','READY','INFO','Branch setup is ready','{"setup":"configured"}',NULL,'DEVELOPMENT_SEED',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','readiness-demo-ngong','enterprise-demo-branch-ngong','branch-demo-ngong-road','DEVICE_EVIDENCE','UNKNOWN','WARNING','Device readiness has not been verified','{}','Test required devices','DEVELOPMENT_SEED',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;
