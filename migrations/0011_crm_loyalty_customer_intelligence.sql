PRAGMA foreign_keys = ON;

-- Pass 10 CRM, loyalty, stored-value and campaign foundation. Monetary values
-- remain integer minor units. Loyalty and stored-value balances are projections
-- of immutable ledgers; no balance column is authoritative.

INSERT INTO permissions (code,description) VALUES
  ('crm.view','View customer relationship summaries'),
  ('crm.customer.view','View customer identity and activity'),
  ('crm.customer.contact.view','View customer contact details'),
  ('crm.customer.value.view','View customer financial value metrics'),
  ('crm.customer.manage','Create and update customer records'),
  ('crm.customer.merge','Merge verified duplicate customer records'),
  ('crm.customer.export','Export authorized customer data'),
  ('crm.privacy.manage','Manage customer privacy requests'),
  ('loyalty.view','View loyalty programs and balances'),
  ('loyalty.manage','Manage loyalty programs, tiers and rewards'),
  ('loyalty.adjust','Post authorized loyalty adjustments'),
  ('loyalty.redeem','Redeem loyalty points'),
  ('voucher.view','View voucher definitions and usage'),
  ('voucher.manage','Manage and issue vouchers'),
  ('gift_card.view','View masked gift-card records and balances'),
  ('gift_card.manage','Issue, block and manage gift cards'),
  ('gift_card.adjust','Post authorized gift-card adjustments'),
  ('campaign.view','View campaign definitions and results'),
  ('campaign.manage','Create and manage campaigns'),
  ('campaign.approve','Approve campaigns'),
  ('campaign.send','Schedule and send approved campaigns'),
  ('feedback.view','View customer feedback'),
  ('feedback.manage','Manage customer feedback follow-up')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

CREATE TABLE customers (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (account_type IN ('INDIVIDUAL','CORPORATE')),
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone_display TEXT,
  email_display TEXT,
  date_of_birth TEXT,
  preferred_language TEXT,
  preferred_branch_id TEXT,
  brand_id TEXT,
  company_name TEXT,
  billing_contact TEXT,
  tax_identifier TEXT,
  invoice_terms_days INTEGER CHECK (invoice_terms_days IS NULL OR invoice_terms_days >= 0),
  account_reference TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ANONYMIZED','BLOCKED')),
  created_source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_activity_at TEXT,
  anonymized_at TEXT,
  anonymized_by TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,customer_code),
  FOREIGN KEY (tenant_id,preferred_branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id)
);

CREATE TABLE customer_identifiers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE','EMAIL','EXTERNAL_CUSTOMER_ID','LOYALTY_NUMBER','MEMBER_TOKEN','MARKETPLACE_REFERENCE','ONLINE_ACCOUNT')),
  provider_connection_id TEXT,
  provider_scope TEXT NOT NULL DEFAULT '',
  normalized_value TEXT NOT NULL,
  display_value TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verification_source TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','MERGED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,identifier_type,provider_scope,normalized_value),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,provider_connection_id) REFERENCES provider_connections(tenant_id,id)
);

CREATE TABLE customer_aliases (
  tenant_id TEXT NOT NULL,
  alias_customer_id TEXT NOT NULL,
  canonical_customer_id TEXT NOT NULL,
  merge_event_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,alias_customer_id),
  FOREIGN KEY (tenant_id,alias_customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,canonical_customer_id) REFERENCES customers(tenant_id,id),
  CHECK (alias_customer_id <> canonical_customer_id)
);

CREATE TABLE customer_duplicate_cases (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  left_customer_id TEXT NOT NULL,
  right_customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('POSSIBLE_DUPLICATE','CONFIRMED_DUPLICATE','MERGED','DISTINCT')),
  evidence_json TEXT NOT NULL,
  resolved_by TEXT,
  resolution_reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,left_customer_id,right_customer_id),
  FOREIGN KEY (tenant_id,left_customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,right_customer_id) REFERENCES customers(tenant_id,id),
  CHECK (left_customer_id <> right_customer_id)
);

CREATE TABLE customer_tags (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (assignment_type IN ('MANUAL','DETERMINISTIC_RULE')),
  rule_json TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE customer_tag_assignments (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,customer_id,tag_id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,tag_id) REFERENCES customer_tags(tenant_id,id)
);

CREATE TABLE customer_consents (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL_MARKETING','SMS_MARKETING','WHATSAPP_MARKETING','PUSH_MARKETING','PHONE_MARKETING')),
  status TEXT NOT NULL CHECK (status IN ('GRANTED','DENIED','WITHDRAWN','UNKNOWN')),
  source TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  actor_id TEXT,
  proof_reference TEXT,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,customer_id,channel,effective_at,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_suppressions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH','PHONE','ALL')),
  reason TEXT NOT NULL CHECK (reason IN ('UNSUBSCRIBED','BOUNCED','COMPLAINT','MANUAL','INVALID_CONTACT','CUSTOMER_REQUEST')),
  source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_by TEXT,
  released_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_notification_preferences (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  preference_key TEXT NOT NULL CHECK (preference_key IN ('ORDER_UPDATES','RECEIPT_DELIVERY','LOYALTY_BALANCE','MARKETING')),
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH','PHONE')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,customer_id,preference_key,channel),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_privacy_requests (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('ACCESS','EXPORT','CORRECTION','ANONYMIZATION','DELETION_WHERE_PERMITTED','MARKETING_OPTOUT')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','VERIFYING','IN_PROGRESS','COMPLETED','REJECTED_WITH_REASON')),
  request_reference TEXT NOT NULL,
  verification_reference TEXT,
  rejection_reason TEXT,
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,request_reference),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_privacy_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,request_id) REFERENCES customer_privacy_requests(tenant_id,id)
);

CREATE TABLE customer_notes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  note TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'CRM' CHECK (visibility IN ('CRM','SERVICE','FINANCE')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_transaction_links (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('ORDER','INVOICE','PAYMENT','REFUND')),
  source_id TEXT NOT NULL,
  link_source TEXT NOT NULL CHECK (link_source IN ('POS_SELECTED','EXACT_IDENTIFIER','OPERATOR_CONFIRMED','IMPORT','MERGE')),
  business_date TEXT NOT NULL,
  currency TEXT,
  gross_minor INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL DEFAULT 0,
  refund_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  channel TEXT,
  item_summary_json TEXT NOT NULL DEFAULT '[]',
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source_type,source_id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE customer_metric_snapshots (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  brand_id TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  period_key TEXT NOT NULL,
  currency TEXT NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  gross_spend_minor INTEGER NOT NULL DEFAULT 0,
  net_spend_minor INTEGER NOT NULL DEFAULT 0,
  refund_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  average_order_minor INTEGER NOT NULL DEFAULT 0,
  first_visit_at TEXT,
  last_visit_at TEXT,
  favorite_branch_id TEXT,
  favorite_channel TEXT,
  favorite_items_json TEXT NOT NULL DEFAULT '[]',
  rfm_json TEXT NOT NULL DEFAULT '{}',
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  evidence_watermark TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,customer_id,brand_id,branch_id,period_key),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_journey_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  branch_id TEXT,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,event_type,source_type,source_id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE loyalty_programs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','EXPIRED','CANCELLED')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('TENANT','BRAND','BRANCH')),
  brand_id TEXT,
  branch_id TEXT,
  effective_from TEXT NOT NULL,
  expires_at TEXT,
  earning_type TEXT NOT NULL CHECK (earning_type IN ('SPEND','ITEM','CATEGORY','VISIT','BONUS')),
  spend_minor_per_point INTEGER CHECK (spend_minor_per_point IS NULL OR spend_minor_per_point > 0),
  minimum_spend_minor INTEGER NOT NULL DEFAULT 0 CHECK (minimum_spend_minor >= 0),
  rounding_policy TEXT NOT NULL DEFAULT 'FLOOR' CHECK (rounding_policy IN ('FLOOR','NEAREST','CEILING')),
  expiry_type TEXT NOT NULL DEFAULT 'NONE' CHECK (expiry_type IN ('NONE','FIXED_DATE','DAYS_AFTER_EARN')),
  expiry_days INTEGER CHECK (expiry_days IS NULL OR expiry_days > 0),
  expiry_date TEXT,
  negative_balance_allowed INTEGER NOT NULL DEFAULT 0 CHECK (negative_balance_allowed IN (0,1)),
  eligible_branches_json TEXT NOT NULL DEFAULT '[]',
  eligible_channels_json TEXT NOT NULL DEFAULT '[]',
  eligible_items_json TEXT NOT NULL DEFAULT '[]',
  eligible_categories_json TEXT NOT NULL DEFAULT '[]',
  exclusions_json TEXT NOT NULL DEFAULT '{}',
  redemption_rules_json TEXT NOT NULL DEFAULT '{}',
  receipt_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK ((scope_type='TENANT' AND brand_id IS NULL AND branch_id IS NULL) OR
         (scope_type='BRAND' AND brand_id IS NOT NULL AND branch_id IS NULL) OR
         (scope_type='BRANCH' AND branch_id IS NOT NULL))
);

CREATE TABLE loyalty_tiers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 0),
  qualification_type TEXT NOT NULL CHECK (qualification_type IN ('ROLLING_SPEND','LIFETIME_SPEND','VISIT_COUNT','POINTS_EARNED')),
  threshold_minor_or_points INTEGER NOT NULL CHECK (threshold_minor_or_points >= 0),
  qualification_window_days INTEGER,
  points_multiplier_numerator INTEGER NOT NULL DEFAULT 1 CHECK (points_multiplier_numerator > 0),
  points_multiplier_denominator INTEGER NOT NULL DEFAULT 1 CHECK (points_multiplier_denominator > 0),
  downgrade_policy TEXT NOT NULL DEFAULT 'RECALCULATE' CHECK (downgrade_policy IN ('RECALCULATE','GRACE_PERIOD','NO_DOWNGRADE')),
  grace_period_days INTEGER,
  benefits_json TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,program_id,code),
  UNIQUE (tenant_id,program_id,rank),
  FOREIGN KEY (tenant_id,program_id) REFERENCES loyalty_programs(tenant_id,id)
);

CREATE TABLE loyalty_rewards (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('FIXED_DISCOUNT','PERCENTAGE_DISCOUNT','FREE_ITEM','FREE_CATEGORY_ITEM','POINTS_BONUS','FREE_DELIVERY','NON_FINANCIAL')),
  points_cost INTEGER NOT NULL DEFAULT 0 CHECK (points_cost >= 0),
  value_minor INTEGER,
  percentage_basis_points INTEGER,
  item_id TEXT,
  category_code TEXT,
  minimum_tier_id TEXT,
  eligibility_json TEXT NOT NULL DEFAULT '{}',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,program_id,code),
  FOREIGN KEY (tenant_id,program_id) REFERENCES loyalty_programs(tenant_id,id),
  FOREIGN KEY (tenant_id,minimum_tier_id) REFERENCES loyalty_tiers(tenant_id,id)
);

CREATE TABLE customer_loyalty_memberships (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  member_number_hash TEXT NOT NULL,
  member_number_last_four TEXT NOT NULL,
  tier_id TEXT,
  tier_effective_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CANCELLED')),
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,program_id,customer_id),
  UNIQUE (tenant_id,member_number_hash),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,program_id) REFERENCES loyalty_programs(tenant_id,id),
  FOREIGN KEY (tenant_id,tier_id) REFERENCES loyalty_tiers(tenant_id,id)
);

CREATE TABLE loyalty_ledger (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  branch_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('EARN','REDEEM','EXPIRE','ADJUSTMENT','REVERSAL','BONUS','TRANSFER')),
  points INTEGER NOT NULL CHECK (points <> 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_entry_id TEXT,
  business_date TEXT NOT NULL,
  expires_at TEXT,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,program_id) REFERENCES loyalty_programs(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,source_entry_id) REFERENCES loyalty_ledger(tenant_id,id)
);

CREATE TABLE voucher_definitions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  campaign_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','EXPIRED','CANCELLED')),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  branch_scope_json TEXT NOT NULL DEFAULT '[]',
  channel_scope_json TEXT NOT NULL DEFAULT '[]',
  item_scope_json TEXT NOT NULL DEFAULT '[]',
  category_scope_json TEXT NOT NULL DEFAULT '[]',
  minimum_spend_minor INTEGER NOT NULL DEFAULT 0 CHECK (minimum_spend_minor >= 0),
  currency TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('FIXED_MINOR','PERCENT_BPS','FREE_ITEM','NON_FINANCIAL')),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  usage_cap INTEGER CHECK (usage_cap IS NULL OR usage_cap > 0),
  per_customer_cap INTEGER CHECK (per_customer_cap IS NULL OR per_customer_cap > 0),
  customer_specific INTEGER NOT NULL DEFAULT 0 CHECK (customer_specific IN (0,1)),
  single_use INTEGER NOT NULL DEFAULT 0 CHECK (single_use IN (0,1)),
  stacking_policy TEXT NOT NULL DEFAULT 'BLOCK' CHECK (stacking_policy IN ('ALLOW','BLOCK','BEST_ONLY','PRIORITY_ORDER')),
  stacking_priority INTEGER NOT NULL DEFAULT 100,
  refund_policy TEXT NOT NULL DEFAULT 'KEEP_REDEMPTION' CHECK (refund_policy IN ('KEEP_REDEMPTION','RESTORE_ON_FULL_REFUND')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE voucher_issues (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  voucher_definition_id TEXT NOT NULL,
  customer_id TEXT,
  code_hash TEXT NOT NULL,
  code_last_four TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REDEEMED','EXPIRED','BLOCKED','CANCELLED')),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code_hash),
  FOREIGN KEY (tenant_id,voucher_definition_id) REFERENCES voucher_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE voucher_redemptions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  voucher_definition_id TEXT NOT NULL,
  voucher_issue_id TEXT,
  customer_id TEXT,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  invoice_id TEXT,
  channel TEXT NOT NULL,
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','REVERSED')),
  source_redemption_id TEXT,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (tenant_id,voucher_issue_id,order_id,status),
  FOREIGN KEY (tenant_id,voucher_definition_id) REFERENCES voucher_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,voucher_issue_id) REFERENCES voucher_issues(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,source_redemption_id) REFERENCES voucher_redemptions(tenant_id,id)
);

CREATE TABLE gift_cards (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_last_four TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REDEEMED','EXPIRED','BLOCKED','CANCELLED')),
  currency TEXT NOT NULL,
  original_value_minor INTEGER NOT NULL CHECK (original_value_minor > 0),
  purchaser_customer_id TEXT,
  recipient_customer_id TEXT,
  liability_account_id TEXT NOT NULL,
  collection_account_id TEXT NOT NULL,
  redemption_account_id TEXT NOT NULL,
  breakage_account_id TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  blocked_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,token_hash),
  FOREIGN KEY (tenant_id,purchaser_customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,recipient_customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,liability_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,collection_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,redemption_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,breakage_account_id) REFERENCES accounts(tenant_id,id)
);

CREATE TABLE gift_card_ledger (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  gift_card_id TEXT NOT NULL,
  branch_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ISSUE','REDEEM','REFUND','ADJUSTMENT','REVERSAL','EXPIRY')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_entry_id TEXT,
  actor_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  journal_entry_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,source_entry_id) REFERENCES gift_card_ledger(tenant_id,id)
);

CREATE TABLE communication_provider_configs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIGURED','DISABLED','DEGRADED','UNKNOWN')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  secret_reference TEXT,
  per_minute_limit INTEGER NOT NULL DEFAULT 60 CHECK (per_minute_limit > 0),
  batch_size INTEGER NOT NULL DEFAULT 100 CHECK (batch_size BETWEEN 1 AND 1000),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,provider_key)
);

CREATE TABLE crm_segments (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  definition_json TEXT NOT NULL,
  lapsed_days INTEGER,
  quality_threshold TEXT NOT NULL DEFAULT 'LOW' CHECK (quality_threshold IN ('HIGH','MEDIUM','LOW')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE crm_segment_snapshots (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  branch_id TEXT,
  as_of TEXT NOT NULL,
  customer_count INTEGER NOT NULL DEFAULT 0,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  definition_hash TEXT NOT NULL,
  evidence_watermark TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,segment_id,branch_id,as_of),
  FOREIGN KEY (tenant_id,segment_id) REFERENCES crm_segments(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE crm_segment_members (
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id,snapshot_id,customer_id),
  FOREIGN KEY (tenant_id,snapshot_id) REFERENCES crm_segment_snapshots(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE campaigns (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  objective TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  channels_json TEXT NOT NULL,
  schedule_at TEXT,
  starts_at TEXT,
  ends_at TEXT,
  template_subject TEXT,
  template_body TEXT NOT NULL,
  template_variables_json TEXT NOT NULL DEFAULT '[]',
  voucher_definition_id TEXT,
  branch_scope_json TEXT NOT NULL DEFAULT '[]',
  brand_scope_json TEXT NOT NULL DEFAULT '[]',
  budget_minor INTEGER,
  currency TEXT,
  provider_config_id TEXT,
  approval_required INTEGER NOT NULL DEFAULT 0 CHECK (approval_required IN (0,1)),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approval_reason TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,segment_id) REFERENCES crm_segments(tenant_id,id),
  FOREIGN KEY (tenant_id,voucher_definition_id) REFERENCES voucher_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,provider_config_id) REFERENCES communication_provider_configs(tenant_id,id)
);

CREATE TABLE campaign_audiences (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH')),
  contact_hash TEXT NOT NULL,
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('ELIGIBLE','NO_CONSENT','MISSING_CONTACT','SUPPRESSED','INACTIVE_CUSTOMER','OUT_OF_SCOPE')),
  eligibility_evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,campaign_id,customer_id,channel),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE campaign_deliveries (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  provider_config_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','SENDING','SENT','DELIVERED','FAILED','BOUNCED','UNSUBSCRIBED','UNKNOWN','DEAD_LETTER')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  next_attempt_at TEXT,
  last_error_code TEXT,
  queued_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (tenant_id,provider_config_id,provider_message_id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,audience_id) REFERENCES campaign_audiences(tenant_id,id),
  FOREIGN KEY (tenant_id,provider_config_id) REFERENCES communication_provider_configs(tenant_id,id)
);

CREATE TABLE campaign_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  delivery_id TEXT,
  customer_id TEXT,
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  attribution_type TEXT CHECK (attribution_type IN ('ATTRIBUTED_BY_RULE','CORRELATED','UNKNOWN')),
  source_type TEXT,
  source_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,provider_event_id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,delivery_id) REFERENCES campaign_deliveries(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_feedback_categories (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE customer_feedback (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  order_id TEXT,
  category_id TEXT NOT NULL,
  survey_type TEXT NOT NULL DEFAULT 'GENERAL' CHECK (survey_type IN ('GENERAL','NPS','CSAT')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 10),
  comment TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','IN_REVIEW','FOLLOW_UP','RESOLVED','DISMISSED')),
  owner_id TEXT,
  resolution TEXT,
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,category_id) REFERENCES customer_feedback_categories(tenant_id,id)
);

CREATE TABLE customer_feedback_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,feedback_id) REFERENCES customer_feedback(tenant_id,id)
);

CREATE TABLE customer_import_jobs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREVIEW','READY','PROCESSING','COMPLETED','FAILED')),
  file_hash TEXT NOT NULL,
  source_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  preview_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key)
);

CREATE TABLE crm_recalculation_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX idx_customers_search ON customers(tenant_id,status,display_name,customer_code);
CREATE INDEX idx_customers_activity ON customers(tenant_id,last_activity_at DESC);
CREATE INDEX idx_customer_identifiers_lookup ON customer_identifiers(tenant_id,identifier_type,normalized_value,status);
CREATE INDEX idx_customer_alias_canonical ON customer_aliases(tenant_id,canonical_customer_id);
CREATE INDEX idx_customer_consent_latest ON customer_consents(tenant_id,customer_id,channel,effective_at DESC);
CREATE INDEX idx_customer_suppression_active ON customer_suppressions(tenant_id,customer_id,channel,active);
CREATE INDEX idx_privacy_status ON customer_privacy_requests(tenant_id,status,requested_at);
CREATE INDEX idx_customer_links_profile ON customer_transaction_links(tenant_id,customer_id,business_date DESC);
CREATE INDEX idx_customer_links_branch ON customer_transaction_links(tenant_id,branch_id,business_date,completed);
CREATE INDEX idx_customer_metrics_dashboard ON customer_metric_snapshots(tenant_id,period_key,branch_id,quality);
CREATE INDEX idx_customer_journey ON customer_journey_events(tenant_id,customer_id,occurred_at DESC);
CREATE INDEX idx_loyalty_program_scope ON loyalty_programs(tenant_id,status,scope_type,branch_id,brand_id);
CREATE INDEX idx_loyalty_ledger_balance ON loyalty_ledger(tenant_id,customer_id,program_id,created_at);
CREATE INDEX idx_loyalty_expiry ON loyalty_ledger(tenant_id,program_id,expires_at,entry_type);
CREATE INDEX idx_voucher_validation ON voucher_definitions(tenant_id,status,valid_from,valid_to);
CREATE INDEX idx_voucher_redemptions_usage ON voucher_redemptions(tenant_id,voucher_definition_id,status,redeemed_at);
CREATE INDEX idx_gift_card_ledger_balance ON gift_card_ledger(tenant_id,gift_card_id,created_at);
CREATE INDEX idx_segments_active ON crm_segments(tenant_id,status);
CREATE INDEX idx_segment_members_customer ON crm_segment_members(tenant_id,customer_id,snapshot_id);
CREATE INDEX idx_campaign_schedule ON campaigns(tenant_id,status,schedule_at);
CREATE INDEX idx_campaign_audience_status ON campaign_audiences(tenant_id,campaign_id,eligibility_status,channel);
CREATE INDEX idx_campaign_delivery_due ON campaign_deliveries(tenant_id,status,next_attempt_at);
CREATE INDEX idx_campaign_delivery_results ON campaign_deliveries(tenant_id,campaign_id,status);
CREATE INDEX idx_feedback_status ON customer_feedback(tenant_id,branch_id,status,submitted_at DESC);
CREATE INDEX idx_crm_recalculation_due ON crm_recalculation_events(tenant_id,status,created_at);

CREATE TRIGGER customer_consent_no_update
BEFORE UPDATE ON customer_consents BEGIN SELECT RAISE(ABORT,'customer consent history is append-only'); END;
CREATE TRIGGER customer_consent_no_delete
BEFORE DELETE ON customer_consents BEGIN SELECT RAISE(ABORT,'customer consent history is append-only'); END;
CREATE TRIGGER privacy_event_no_update
BEFORE UPDATE ON customer_privacy_events BEGIN SELECT RAISE(ABORT,'privacy events are append-only'); END;
CREATE TRIGGER privacy_event_no_delete
BEFORE DELETE ON customer_privacy_events BEGIN SELECT RAISE(ABORT,'privacy events are append-only'); END;
CREATE TRIGGER loyalty_ledger_no_update
BEFORE UPDATE ON loyalty_ledger BEGIN SELECT RAISE(ABORT,'loyalty ledger is append-only'); END;
CREATE TRIGGER loyalty_ledger_no_delete
BEFORE DELETE ON loyalty_ledger BEGIN SELECT RAISE(ABORT,'loyalty ledger is append-only'); END;
CREATE TRIGGER voucher_redemption_no_update
BEFORE UPDATE ON voucher_redemptions BEGIN SELECT RAISE(ABORT,'voucher redemption history is append-only'); END;
CREATE TRIGGER voucher_redemption_no_delete
BEFORE DELETE ON voucher_redemptions BEGIN SELECT RAISE(ABORT,'voucher redemption history is append-only'); END;
CREATE TRIGGER gift_card_ledger_no_update
BEFORE UPDATE ON gift_card_ledger BEGIN SELECT RAISE(ABORT,'gift card ledger is append-only'); END;
CREATE TRIGGER gift_card_ledger_no_delete
BEFORE DELETE ON gift_card_ledger BEGIN SELECT RAISE(ABORT,'gift card ledger is append-only'); END;
CREATE TRIGGER campaign_event_no_update
BEFORE UPDATE ON campaign_events BEGIN SELECT RAISE(ABORT,'campaign events are append-only'); END;
CREATE TRIGGER campaign_event_no_delete
BEFORE DELETE ON campaign_events BEGIN SELECT RAISE(ABORT,'campaign events are append-only'); END;
CREATE TRIGGER feedback_event_no_update
BEFORE UPDATE ON customer_feedback_events BEGIN SELECT RAISE(ABORT,'feedback events are append-only'); END;
CREATE TRIGGER feedback_event_no_delete
BEFORE DELETE ON customer_feedback_events BEGIN SELECT RAISE(ABORT,'feedback events are append-only'); END;
CREATE TRIGGER customer_alias_no_update
BEFORE UPDATE ON customer_aliases BEGIN SELECT RAISE(ABORT,'customer merge aliases are immutable'); END;
CREATE TRIGGER customer_alias_no_delete
BEFORE DELETE ON customer_aliases BEGIN SELECT RAISE(ABORT,'customer merge aliases are immutable'); END;

CREATE TRIGGER loyalty_ledger_non_negative
BEFORE INSERT ON loyalty_ledger
WHEN NEW.points < 0
 AND COALESCE((SELECT negative_balance_allowed FROM loyalty_programs
   WHERE tenant_id=NEW.tenant_id AND id=NEW.program_id),0)=0
 AND COALESCE((SELECT SUM(points) FROM loyalty_ledger
   WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id
     AND program_id=NEW.program_id),0) + NEW.points < 0
BEGIN SELECT RAISE(ABORT,'LOYALTY_BALANCE_INSUFFICIENT'); END;

CREATE TRIGGER gift_card_ledger_currency_guard
BEFORE INSERT ON gift_card_ledger
WHEN NEW.currency <> COALESCE((SELECT currency FROM gift_cards
  WHERE tenant_id=NEW.tenant_id AND id=NEW.gift_card_id),'')
BEGIN SELECT RAISE(ABORT,'GIFT_CARD_CURRENCY_MISMATCH'); END;

CREATE TRIGGER gift_card_ledger_non_negative
BEFORE INSERT ON gift_card_ledger
WHEN NEW.amount_minor < 0
 AND COALESCE((SELECT SUM(amount_minor) FROM gift_card_ledger
   WHERE tenant_id=NEW.tenant_id AND gift_card_id=NEW.gift_card_id),0) + NEW.amount_minor < 0
BEGIN SELECT RAISE(ABORT,'GIFT_CARD_BALANCE_INSUFFICIENT'); END;

CREATE TRIGGER voucher_redemption_usage_guard
BEFORE INSERT ON voucher_redemptions
WHEN NEW.status='CONFIRMED' AND (
  (COALESCE((SELECT usage_cap FROM voucher_definitions
    WHERE tenant_id=NEW.tenant_id AND id=NEW.voucher_definition_id),0)>0
   AND (SELECT COUNT(*) FROM voucher_redemptions
     WHERE tenant_id=NEW.tenant_id AND voucher_definition_id=NEW.voucher_definition_id
       AND status='CONFIRMED') >= (SELECT usage_cap FROM voucher_definitions
         WHERE tenant_id=NEW.tenant_id AND id=NEW.voucher_definition_id))
  OR
  (NEW.customer_id IS NOT NULL
   AND COALESCE((SELECT per_customer_cap FROM voucher_definitions
     WHERE tenant_id=NEW.tenant_id AND id=NEW.voucher_definition_id),0)>0
   AND (SELECT COUNT(*) FROM voucher_redemptions
     WHERE tenant_id=NEW.tenant_id AND voucher_definition_id=NEW.voucher_definition_id
       AND customer_id=NEW.customer_id AND status='CONFIRMED') >=
       (SELECT per_customer_cap FROM voucher_definitions
         WHERE tenant_id=NEW.tenant_id AND id=NEW.voucher_definition_id))
  OR
  (NEW.voucher_issue_id IS NOT NULL
   AND COALESCE((SELECT single_use FROM voucher_definitions
     WHERE tenant_id=NEW.tenant_id AND id=NEW.voucher_definition_id),0)=1
   AND EXISTS (SELECT 1 FROM voucher_redemptions
     WHERE tenant_id=NEW.tenant_id AND voucher_issue_id=NEW.voucher_issue_id
       AND status='CONFIRMED'))
)
BEGIN SELECT RAISE(ABORT,'VOUCHER_USAGE_LIMIT_REACHED'); END;

INSERT INTO schema_migrations (version,name,checksum,applied_at)
VALUES (11,'crm_loyalty_customer_intelligence','pass10-0011-v1',CURRENT_TIMESTAMP);
