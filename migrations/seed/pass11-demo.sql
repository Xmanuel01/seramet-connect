-- Explicit development-only digital guest seed. Production migrations remain data-free.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT 'tenant-demo-mona','role-demo-branch-manager',code
FROM permissions
WHERE code LIKE 'reservation.%' OR code LIKE 'waitlist.%' OR code LIKE 'guest_order.%'
   OR code IN ('guest_service.manage','table.manage','digital_menu.manage','qr.manage')
ON CONFLICT DO NOTHING;

INSERT INTO service_areas (tenant_id,id,branch_id,name,active,payload_json)
VALUES
  ('tenant-demo-mona','area-demo-main','branch-demo-westlands','Main Dining',1,'{}'),
  ('tenant-demo-mona','area-demo-terrace','branch-demo-westlands','Terrace',1,'{}'),
  ('tenant-demo-mona','area-demo-ngong-main','branch-demo-ngong-road','Main Dining',1,'{}')
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO restaurant_tables
  (tenant_id,id,branch_id,service_area_id,code,seats,active,payload_json)
VALUES
  ('tenant-demo-mona','table-demo-w-01','branch-demo-westlands','area-demo-main','T01',2,1,'{}'),
  ('tenant-demo-mona','table-demo-w-02','branch-demo-westlands','area-demo-main','T02',4,1,'{}'),
  ('tenant-demo-mona','table-demo-w-03','branch-demo-westlands','area-demo-main','T03',4,1,'{}'),
  ('tenant-demo-mona','table-demo-w-04','branch-demo-westlands','area-demo-main','T04',6,1,'{}'),
  ('tenant-demo-mona','table-demo-w-05','branch-demo-westlands','area-demo-terrace','T05',4,1,'{}'),
  ('tenant-demo-mona','table-demo-w-06','branch-demo-westlands','area-demo-terrace','T06',8,1,'{}'),
  ('tenant-demo-mona','table-demo-n-01','branch-demo-ngong-road','area-demo-ngong-main','T01',2,1,'{}'),
  ('tenant-demo-mona','table-demo-n-02','branch-demo-ngong-road','area-demo-ngong-main','T02',4,1,'{}'),
  ('tenant-demo-mona','table-demo-n-03','branch-demo-ngong-road','area-demo-ngong-main','T03',6,1,'{}')
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO public_branch_profiles
  (tenant_id,id,brand_id,branch_id,restaurant_slug,branch_slug,public_name,description,logo_url,
   cover_url,address,public_phone,public_email,currency,public_status,service_modes_json,
   operating_hours_json,social_links_json,branding_json,legal_links_json,minimum_order_minor,
   ordering_enabled,reservations_enabled,publicly_enabled,updated_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','public-demo-westlands','brand-demo-mona','branch-demo-westlands',
   'mona-swahili-demo','westlands','Mona Swahili','Swahili dining, prepared fresh for every service.',
   NULL,'/guest-cover.png','Kipro Centre, Sports Road','0719 427 919',
   'info@monaswahili.co.ke','KES','OPEN','["DINE_IN","QR_TABLE","PICKUP","DIRECT_DELIVERY","WEB_ORDER","KIOSK"]',
   '{"monday":["08:00","23:00"],"tuesday":["08:00","23:00"],"wednesday":["08:00","23:00"],"thursday":["08:00","23:00"],"friday":["08:00","23:59"],"saturday":["08:00","23:59"],"sunday":["08:00","22:00"]}',
   '{}','{"primary":"#147d64","accent":"#d89b2b","surface":"#fffdf8"}','{}',50000,1,1,1,
   'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','public-demo-ngong','brand-demo-mona','branch-demo-ngong-road',
   'mona-swahili-demo','ngong-road','Mona Swahili','Swahili dining, prepared fresh for every service.',
   NULL,'/guest-cover.png','Ngong Road Branch','0719 427 919',
   'info@monaswahili.co.ke','KES','OPEN','["DINE_IN","PICKUP","WEB_ORDER"]',
   '{"monday":["08:00","22:00"],"tuesday":["08:00","22:00"],"wednesday":["08:00","22:00"],"thursday":["08:00","22:00"],"friday":["08:00","23:00"],"saturday":["08:00","23:00"],"sunday":["08:00","22:00"]}',
   '{}','{"primary":"#147d64","accent":"#d89b2b","surface":"#fffdf8"}','{}',50000,1,1,1,
   'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO reservation_policies
  (tenant_id,id,branch_id,slot_interval_minutes,default_duration_minutes,buffer_minutes,
   minimum_party_size,maximum_party_size,advance_booking_days,verification_policy,
   anonymous_allowed,reservation_hours_json,cancellation_policy_json,deposit_type,deposit_value,
   deposit_liability_account_id,deposit_payment_method_id,hold_minutes,active,updated_by,
   created_at,updated_at)
VALUES
  ('tenant-demo-mona','reservation-policy-demo-westlands','branch-demo-westlands',30,120,15,1,12,90,
   'STAFF_CONFIRMATION',1,'{}','{"guestCancellationMinutes":120,"refundPolicy":"REVIEW"}',
   'NONE',0,NULL,NULL,10,1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tenant-demo-mona','reservation-policy-demo-ngong','branch-demo-ngong-road',30,120,15,1,10,60,
   'STAFF_CONFIRMATION',1,'{}','{"guestCancellationMinutes":120,"refundPolicy":"REVIEW"}',
   'NONE',0,NULL,NULL,10,1,'system:development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO delivery_zones
  (tenant_id,id,branch_id,code,name,method,definition_json,minimum_order_minor,
   delivery_fee_minor,estimated_min_minutes,estimated_max_minutes,currency,active,created_at,updated_at)
VALUES
  ('tenant-demo-mona','zone-demo-westlands-near','branch-demo-westlands','NEAR','Nearby delivery','AREA',
   '{"areas":["Configured nearby area"]}',100000,25000,30,50,'KES',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json)
VALUES
  ('tenant-demo-mona','channel-demo-qr','QR-TABLE','QR',1,'{"displayName":"QR table","guestEnabled":true}'),
  ('tenant-demo-mona','channel-demo-web','WEB-DIRECT','WEB',1,'{"displayName":"Direct web","guestEnabled":true}'),
  ('tenant-demo-mona','channel-demo-kiosk','KIOSK-DIRECT','KIOSK',1,'{"displayName":"Self service","guestEnabled":true}')
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO payment_methods
  (tenant_id,id,code,category,provider_connection_id,settlement_account_id,clearing_account_id,
   receivable_account_id,cash_account_id,active,payload_json)
VALUES
  ('tenant-demo-mona','payment-demo-gift-card','GIFT_CARD','VOUCHER',NULL,
   'account-demo-gift-card-liability',NULL,'account-demo-customer-receivable',NULL,1,
   '{"displayName":"Gift Card","sortOrder":60,"requiresReference":true,"supportsSplit":true,"liabilityAccountId":"account-demo-gift-card-liability","metadata":{"valueType":"GIFT_CARD","guestEnabled":true}}'),
  ('tenant-demo-mona','payment-demo-voucher','PROMOTIONAL_VOUCHER','VOUCHER',NULL,
   'account-demo-promotion-expense',NULL,'account-demo-customer-receivable',NULL,1,
   '{"displayName":"Voucher","sortOrder":61,"requiresReference":true,"supportsSplit":true,"metadata":{"valueType":"PROMOTION","promotionAccountId":"account-demo-promotion-expense"}}'),
  ('tenant-demo-mona','payment-demo-loyalty','LOYALTY_REWARD','LOYALTY',NULL,
   'account-demo-promotion-expense',NULL,'account-demo-customer-receivable',NULL,1,
   '{"displayName":"Loyalty Reward","sortOrder":62,"requiresCustomer":true,"supportsSplit":true,"metadata":{"guestEnabled":true,"promotionAccountId":"account-demo-promotion-expense"}}')
ON CONFLICT(tenant_id,id) DO UPDATE SET
  active=excluded.active,
  settlement_account_id=excluded.settlement_account_id,
  clearing_account_id=excluded.clearing_account_id,
  receivable_account_id=excluded.receivable_account_id,
  cash_account_id=excluded.cash_account_id,
  payload_json=excluded.payload_json;
