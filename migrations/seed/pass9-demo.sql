-- Explicit development-only Seramet intelligence seed. Never run in production.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions WHERE code LIKE 'intelligence.%'
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (tenant_id,key,enabled,configuration_json,updated_by,updated_at)
VALUES ('tenant-demo-mona','intelligence.enabled',1,'{}','system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,key) DO UPDATE SET enabled=excluded.enabled,
  configuration_json=excluded.configuration_json,updated_by=excluded.updated_by,
  updated_at=excluded.updated_at;

INSERT INTO plan_definitions (id,code,name,status,created_at,updated_at)
VALUES ('plan-demo-intelligence','DEMO_INTELLIGENCE','Development intelligence','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

INSERT INTO tenant_subscriptions
  (tenant_id,id,plan_id,status,starts_at,created_at,updated_at)
VALUES
  ('tenant-demo-mona','subscription-demo-intelligence','plan-demo-intelligence','ACTIVE',
   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO feature_entitlements
  (tenant_id,subscription_id,feature_key,enabled,limits_json)
VALUES
  ('tenant-demo-mona','subscription-demo-intelligence','intelligence.basic',1,'{}'),
  ('tenant-demo-mona','subscription-demo-intelligence','intelligence.finance',1,'{}'),
  ('tenant-demo-mona','subscription-demo-intelligence','intelligence.owner',1,'{}'),
  ('tenant-demo-mona','subscription-demo-intelligence','intelligence.scheduled_briefs',1,'{}'),
  ('tenant-demo-mona','subscription-demo-intelligence','intelligence.advanced_analysis',1,'{}')
ON CONFLICT(tenant_id,subscription_id,feature_key) DO UPDATE SET enabled=excluded.enabled,
  limits_json=excluded.limits_json;

INSERT INTO intelligence_provider_configs
  (tenant_id,id,provider_key,display_name,model_identifier,enabled,status,capabilities_json,
   secret_reference,timeout_ms,max_input_units,max_output_units,per_minute_limit,
   daily_request_limit,monthly_request_limit,per_user_daily_limit,retention_mode,
   allowed_features_json,allowed_role_ids_json,prompt_version,configuration_json,
   created_by,created_at,updated_by,updated_at)
VALUES
  ('tenant-demo-mona','intelligence-provider-demo','DETERMINISTIC_TEST','Development evidence renderer',
   'deterministic-evidence-v1',1,'CONFIGURED','["STRUCTURED_OUTPUT"]',NULL,5000,50000,5000,
   120,1000,20000,500,'SHORT','[]','[]','seramet-intelligence-v1','{"demo":true}',
   'user-demo-emmanuel-obiambo',CURRENT_TIMESTAMP,'user-demo-emmanuel-obiambo',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO UPDATE SET enabled=1,status='CONFIGURED',updated_at=CURRENT_TIMESTAMP;

INSERT INTO intelligence_prompt_versions
  (tenant_id,id,version,template_hash,service_version,active,created_by,created_at)
VALUES
  ('tenant-demo-mona','prompt-demo-v1','seramet-intelligence-v1','deterministic-development-template',
   'pass9',1,'user-demo-emmanuel-obiambo',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,version) DO NOTHING;
