-- Explicit development-only CRM seed. Production migrations contain no restaurant data.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions
WHERE code LIKE 'crm.%' OR code LIKE 'loyalty.%' OR code LIKE 'voucher.%'
   OR code LIKE 'gift_card.%' OR code LIKE 'campaign.%' OR code LIKE 'feedback.%'
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (tenant_id,key,enabled,configuration_json,updated_by,updated_at)
VALUES ('tenant-demo-mona','crm.enabled',1,'{"offlineRedemptionPolicy":"BLOCK_REDEEM","phoneDefaultCallingCode":"254","phoneNationalPrefix":"0","campaignAttributionWindowDays":7}',
  'system:development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,key) DO UPDATE SET enabled=excluded.enabled,
  configuration_json=excluded.configuration_json,updated_at=excluded.updated_at;

INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
VALUES
  ('tenant-demo-mona','account-demo-gift-card-liability',NULL,'DEMO-GIFT-LIABILITY','Gift card liability','LIABILITY','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-gift-card-collection',NULL,'DEMO-GIFT-COLLECTION','Gift card collection','ASSET','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-gift-card-redemption',NULL,'DEMO-GIFT-REDEMPTION','Gift card redemption clearing','ASSET','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-gift-liability',NULL,'DEMO-GIFT-LIABILITY-LEGACY','Gift card liability compatibility','LIABILITY','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-gift-collection',NULL,'DEMO-GIFT-COLLECTION-LEGACY','Gift card collection compatibility','ASSET','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-gift-redemption',NULL,'DEMO-GIFT-REDEMPTION-LEGACY','Gift card redemption compatibility','ASSET','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-customer-receivable',NULL,'DEMO-CUSTOMER-RECEIVABLE','Customer receivable','ASSET','KES',1,'{}'),
  ('tenant-demo-mona','account-demo-promotion-expense',NULL,'DEMO-PROMOTION-EXPENSE','Promotion expense','EXPENSE','KES',1,'{}')
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customers
  (tenant_id,id,customer_code,account_type,display_name,first_name,last_name,phone_display,
   email_display,preferred_language,preferred_branch_id,brand_id,status,created_source,created_by,
   last_activity_at,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','customer-demo-001','CUS-0001','INDIVIDUAL','Kelvin Otieno','Kelvin','Otieno',
   '+254 712 448 210','kelvin.o@example.test','en','branch-demo-westlands','brand-demo-mona','ACTIVE',
   'DEVELOPMENT_SEED','system:development-seed','2026-08-29T18:20:00.000Z','{}',
   '2026-05-04T09:00:00.000Z',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','customer-demo-002','CUS-0002','INDIVIDUAL','Sarah Njeri','Sarah','Njeri',
   '+254 722 100 201','sarah.n@example.test','en','branch-demo-westlands','brand-demo-mona','ACTIVE',
   'DEVELOPMENT_SEED','system:development-seed','2026-08-31T12:10:00.000Z','{}',
   '2026-07-12T10:00:00.000Z',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','customer-demo-003','CUS-0003','CORPORATE','Configured Catering Account',NULL,NULL,
   '+254 733 100 202','billing@configured-catering.example.test','en','branch-demo-westlands','brand-demo-mona','ACTIVE',
   'DEVELOPMENT_SEED','system:development-seed','2026-08-20T08:00:00.000Z',
   '{"companyName":"Configured Catering Account"}','2026-04-02T08:00:00.000Z',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_identifiers
  (tenant_id,id,customer_id,identifier_type,provider_connection_id,provider_scope,normalized_value,
   display_value,verified,verification_source,status,created_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','cid-demo-001-phone','customer-demo-001','PHONE',NULL,'','+254712448210',
   '+254 712 448 210',1,'DEVELOPMENT_SEED','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','cid-demo-001-email','customer-demo-001','EMAIL',NULL,'','kelvin.o@example.test',
   'kelvin.o@example.test',1,'DEVELOPMENT_SEED','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','cid-demo-002-phone','customer-demo-002','PHONE',NULL,'','+254722100201',
   '+254 722 100 201',1,'DEVELOPMENT_SEED','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','cid-demo-003-email','customer-demo-003','EMAIL',NULL,'','billing@configured-catering.example.test',
   'billing@configured-catering.example.test',1,'DEVELOPMENT_SEED','ACTIVE','system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_consents
  (tenant_id,id,customer_id,channel,status,source,policy_version,actor_id,proof_reference,effective_at,created_at)
VALUES
  ('tenant-demo-mona','consent-demo-001-email','customer-demo-001','EMAIL_MARKETING','GRANTED',
   'DEVELOPMENT_SEED','demo-v1','system:development-seed','demo-proof','2026-05-04T09:01:00.000Z',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','consent-demo-001-sms','customer-demo-001','SMS_MARKETING','GRANTED',
   'DEVELOPMENT_SEED','demo-v1','system:development-seed','demo-proof','2026-05-04T09:01:00.000Z',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','consent-demo-002-email','customer-demo-002','EMAIL_MARKETING','UNKNOWN',
   'DEVELOPMENT_SEED','demo-v1','system:development-seed',NULL,'2026-07-12T10:00:00.000Z',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO loyalty_programs
  (tenant_id,id,code,name,status,scope_type,brand_id,branch_id,effective_from,earning_type,
   spend_minor_per_point,minimum_spend_minor,rounding_policy,expiry_type,expiry_days,
   negative_balance_allowed,eligible_branches_json,eligible_channels_json,eligible_items_json,
   eligible_categories_json,exclusions_json,redemption_rules_json,receipt_message,created_by,
   created_at,updated_at)
VALUES
  ('tenant-demo-mona','loyalty-demo-program','DEMO-LOYALTY','Configured Loyalty','ACTIVE','TENANT',NULL,NULL,
   '2026-01-01T00:00:00.000Z','SPEND',10000,0,'FLOOR','DAYS_AFTER_EARN',365,0,'[]','[]','[]','[]','{}',
   '{"minimumRedemptionPoints":100,"redemptionAccountId":"account-demo-promotion-expense"}', 'Points balance is available on your customer profile.',
   'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO loyalty_tiers
  (tenant_id,id,program_id,code,name,rank,qualification_type,threshold_minor_or_points,
   qualification_window_days,points_multiplier_numerator,points_multiplier_denominator,
   downgrade_policy,benefits_json,effective_from,active,created_at,updated_at)
VALUES
  ('tenant-demo-mona','tier-demo-entry','loyalty-demo-program','ENTRY','Member',0,'LIFETIME_SPEND',0,NULL,1,1,
   'RECALCULATE','{}','2026-01-01T00:00:00.000Z',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','tier-demo-plus','loyalty-demo-program','PLUS','Plus',1,'LIFETIME_SPEND',10000000,NULL,3,2,
   'RECALCULATE','{"priorityRewardAccess":true}','2026-01-01T00:00:00.000Z',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_loyalty_memberships
  (tenant_id,id,customer_id,program_id,member_number_hash,member_number_last_four,tier_id,
   tier_effective_at,status,joined_at,created_at,updated_at)
VALUES
  ('tenant-demo-mona','membership-demo-001','customer-demo-001','loyalty-demo-program',
   'demo-member-hash-001','4821','tier-demo-plus','2026-08-01T00:00:00.000Z','ACTIVE',
   '2026-05-04T09:02:00.000Z',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','membership-demo-002','customer-demo-002','loyalty-demo-program',
   'demo-member-hash-002','1907','tier-demo-entry','2026-07-12T10:00:00.000Z','ACTIVE',
   '2026-07-12T10:00:00.000Z',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO loyalty_ledger
  (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
   business_date,expires_at,reason,actor_id,correlation_id,idempotency_key,created_at)
VALUES
  ('tenant-demo-mona','ledger-demo-001','customer-demo-001','loyalty-demo-program','branch-demo-westlands',
   'EARN',4820,'DEVELOPMENT_SEED','seed-001','2026-08-29','2027-08-29T23:59:59.000Z',
   'Development demonstration balance','system:development-seed','seed-correlation-001','seed-loyalty-001',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','ledger-demo-002','customer-demo-002','loyalty-demo-program','branch-demo-westlands',
   'EARN',2140,'DEVELOPMENT_SEED','seed-002','2026-08-31','2027-08-31T23:59:59.000Z',
   'Development demonstration balance','system:development-seed','seed-correlation-002','seed-loyalty-002',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_metric_snapshots
  (tenant_id,customer_id,brand_id,branch_id,period_key,currency,visit_count,order_count,
   gross_spend_minor,net_spend_minor,refund_minor,discount_minor,average_order_minor,
   first_visit_at,last_visit_at,favorite_branch_id,favorite_channel,favorite_items_json,
   rfm_json,quality,evidence_watermark,calculated_at)
VALUES
  ('tenant-demo-mona','customer-demo-001','brand-demo-mona','branch-demo-westlands','LIFETIME','KES',64,64,18460000,18120000,120000,220000,
   283125,'2026-05-04T09:00:00.000Z','2026-08-29T18:20:00.000Z','branch-demo-westlands','DINE_IN',
   '[{"name":"Configured menu item","quantity":12}]','{"recencyDays":3,"frequency":64,"monetaryMinor":18120000}',
   'MEDIUM','development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','customer-demo-002','brand-demo-mona','branch-demo-westlands','LIFETIME','KES',18,18,6840000,6710000,0,130000,
   372778,'2026-07-12T10:00:00.000Z','2026-08-31T12:10:00.000Z','branch-demo-westlands','TAKEAWAY',
   '[]','{"recencyDays":1,"frequency":18,"monetaryMinor":6710000}','MEDIUM','development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','customer-demo-003','brand-demo-mona','branch-demo-westlands','LIFETIME','KES',9,9,42000000,42000000,0,0,
   4666667,'2026-04-02T08:00:00.000Z','2026-08-20T08:00:00.000Z','branch-demo-westlands','CORPORATE',
   '[]','{"recencyDays":12,"frequency":9,"monetaryMinor":42000000}','MEDIUM','development-seed',CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,customer_id,brand_id,branch_id,period_key) DO UPDATE SET
  evidence_watermark=excluded.evidence_watermark,calculated_at=excluded.calculated_at;

INSERT INTO crm_segments
  (tenant_id,id,code,name,description,status,definition_json,lapsed_days,quality_threshold,
   created_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','segment-demo-repeat','REPEAT','Repeat customers','At least two completed paid orders',
   'ACTIVE','{"all":[{"field":"orderCount","operator":"GTE","value":2}]}',NULL,'LOW',
   'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','segment-demo-lapsed','LAPSED','Lapsed customers','Last completed order exceeds configured days',
   'ACTIVE','{"all":[{"field":"daysSinceLastVisit","operator":"GT","value":60}]}',60,'LOW',
   'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_feedback_categories
  (tenant_id,id,code,name,active,created_at,updated_at)
VALUES
  ('tenant-demo-mona','feedback-category-food','FOOD','Food',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','feedback-category-service','SERVICE','Service',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','feedback-category-speed','SPEED','Speed',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO customer_feedback
  (tenant_id,id,branch_id,customer_id,order_id,category_id,survey_type,rating,comment,source,
   status,submitted_at,created_at,updated_at)
VALUES
  ('tenant-demo-mona','feedback-demo-001','branch-demo-westlands','customer-demo-001',NULL,
   'feedback-category-service','CSAT',5,'Service follow-up was prompt.','DEVELOPMENT_SEED','RESOLVED',
   '2026-08-29T19:00:00.000Z',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','feedback-demo-002','branch-demo-westlands','customer-demo-002',NULL,
   'feedback-category-speed','NPS',8,'Ordering was easy.','DEVELOPMENT_SEED','OPEN',
   '2026-08-31T12:40:00.000Z',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;
