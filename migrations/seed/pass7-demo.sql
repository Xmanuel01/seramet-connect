-- Explicit development-only management seed. Never run as a production migration.
INSERT INTO permissions (code,description) VALUES
  ('management.view','View authoritative management intelligence'),
  ('management.actions.manage','Manage persisted management actions'),
  ('management.targets.manage','Manage effective targets and thresholds'),
  ('management.finance.view','View management finance metrics'),
  ('tenant.scope.all_branches','Use authorized all-branch scope')
ON CONFLICT(code) DO NOTHING;

INSERT INTO roles (tenant_id,id,code,name,active,payload_json)
VALUES
  ('tenant-demo-mona','role-demo-branch-manager','BRANCH_MANAGER','Branch Manager',1,'{}');

INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES
  ('tenant-demo-mona','role-demo-branch-manager','management.view'),
  ('tenant-demo-mona','role-demo-branch-manager','management.actions.manage'),
  ('tenant-demo-mona','role-demo-branch-manager','management.targets.manage'),
  ('tenant-demo-mona','role-demo-branch-manager','management.finance.view');

INSERT INTO users
  (tenant_id,id,email,name,active,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','user-demo-emmanuel-obiambo',NULL,'Emmanuel Obiambo',1,'{}',
   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO user_roles (tenant_id,user_id,role_id)
VALUES ('tenant-demo-mona','user-demo-emmanuel-obiambo','role-demo-branch-manager');

INSERT INTO user_branches (tenant_id,user_id,branch_id)
VALUES ('tenant-demo-mona','user-demo-emmanuel-obiambo','branch-demo-westlands');

INSERT INTO warehouses
  (tenant_id,id,branch_id,code,name,active,payload_json)
VALUES
  ('tenant-demo-mona','warehouse-demo-westlands','branch-demo-westlands','MAIN','Main Store',1,'{}');

INSERT INTO stations
  (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
VALUES
  ('tenant-demo-mona','station-demo-main','branch-demo-westlands','MAIN','Main Kitchen','KITCHEN',1,'{}');

INSERT INTO employees
  (tenant_id,id,branch_id,employee_number,status,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','employee-demo-service','branch-demo-westlands','EMP-DEMO-01','ACTIVE',
   '{"name":"Configured employee"}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO suppliers
  (tenant_id,id,code,name,currency,active,payload_json,created_at,updated_at)
VALUES
  ('tenant-demo-mona','supplier-demo-primary','SUP-DEMO-01','Configured supplier','KES',1,'{}',
   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO order_channels
  (tenant_id,id,code,channel_type,active,payload_json)
VALUES
  ('tenant-demo-mona','channel-demo-online','ONLINE-DEMO','ONLINE',1,
   '{"name":"Configured online channel"}');

INSERT INTO daily_branch_metrics
  (tenant_id,branch_id,business_date,currency,gross_sales_minor,discounts_minor,refunds_minor,
   net_sales_minor,tax_minor,service_charge_minor,net_revenue_minor,marketplace_commission_minor,
   payment_processing_fees_minor,delivery_fees_minor,cogs_minor,gross_profit_minor,gross_margin_bps,
   food_cost_bps,labour_cost_minor,labour_cost_bps,operating_expenses_minor,contribution_minor,
   order_count,average_order_value_minor,average_prep_time_ms,payment_variance_minor,wastage_minor,
   inventory_variance_minor,quality,quality_reasons_json,source_watermark,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'KES',4850000,120000,50000,4680000,
   696000,180000,3804000,185000,72000,45000,1280000,2524000,6635,3365,760000,1998,420000,
   1344000,126,37143,812000,0,46000,21000,'HIGH','[]','development-seed',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','branch-demo-ngong-road',date('now'),'KES',3920000,85000,20000,3815000,
   570000,145000,3100000,94000,54000,28000,990000,2110000,6806,3194,625000,2016,350000,
   1037000,104,36683,744000,0,25000,8000,'HIGH','[]','development-seed',CURRENT_TIMESTAMP);

INSERT INTO financial_summary_periods
  (tenant_id,id,branch_id,period_type,period_start,period_end,currency,gross_sales_minor,
   discounts_minor,refunds_minor,net_sales_minor,tax_minor,service_charge_minor,net_revenue_minor,
   cogs_minor,gross_profit_minor,gross_margin_bps,labour_cost_minor,operating_expenses_minor,
   marketplace_commission_minor,payment_processing_fees_minor,delivery_fees_minor,contribution_minor,
   flash_operating_result_minor,quality,quality_reasons_json,calculated_at)
VALUES
  ('tenant-demo-mona','flash-demo-westlands','branch-demo-westlands','DAY',date('now'),date('now'),
   'KES',4850000,120000,50000,4680000,696000,180000,3804000,1280000,2524000,6635,760000,
   420000,185000,72000,45000,1344000,864000,'COMPLETE','[]',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','flash-demo-ngong-road','branch-demo-ngong-road','DAY',date('now'),date('now'),
   'KES',3920000,85000,20000,3815000,570000,145000,3100000,990000,2110000,6806,625000,
   350000,94000,54000,28000,1037000,687000,'COMPLETE','[]',CURRENT_TIMESTAMP);

INSERT INTO daily_channel_metrics
  (tenant_id,branch_id,business_date,channel_key,channel_id,channel_label,currency,order_count,
   cancelled_count,refund_count,gross_sales_minor,discounts_minor,refunds_minor,net_sales_minor,
   commission_minor,provider_fees_minor,delivery_fees_minor,cogs_minor,contribution_minor,
   contribution_bps,average_order_value_minor,cancellation_bps,refund_bps,average_fulfilment_ms,
   settlement_difference_minor,quality,quality_reasons_json,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'channel-demo-online','channel-demo-online',
   'Configured online channel','KES',34,2,1,1520000,40000,18000,1462000,185000,32000,45000,
   470000,730000,4993,43000,588,294,1980000,0,'HIGH','[]',CURRENT_TIMESTAMP);

INSERT INTO daily_station_metrics
  (tenant_id,branch_id,business_date,station_id,ticket_count,completed_count,late_count,average_prep_ms,
   median_prep_ms,p90_prep_ms,average_ready_pickup_ms,throughput_per_hour_milli,quality,
   quality_reasons_json,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'station-demo-main',89,84,7,812000,744000,
   1120000,185000,8400,'HIGH','[]',CURRENT_TIMESTAMP);

INSERT INTO daily_staff_metrics
  (tenant_id,branch_id,business_date,employee_id,shift_count,worked_minutes,late_minutes,
   labour_cost_minor,orders_handled,net_sales_minor,average_order_value_minor,average_service_ms,
   void_requests,approved_discounts,refund_involvement,quality,quality_reasons_json,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'employee-demo-service',1,510,8,86000,31,
   1180000,38065,355000,1,2,0,'HIGH','[]',CURRENT_TIMESTAMP);

INSERT INTO daily_supplier_metrics
  (tenant_id,branch_id,business_date,supplier_id,currency,purchase_value_minor,order_count,
   average_lead_time_minutes,on_time_bps,fill_rate_bps,rejected_quantity_micro,price_variance_minor,
   return_value_minor,invoice_match_exceptions,outstanding_payable_minor,quality,quality_reasons_json,
   calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'supplier-demo-primary','KES',860000,4,
   1540,7500,9600,120000,34000,0,1,310000,'HIGH','[]',CURRENT_TIMESTAMP);

INSERT INTO daily_menu_item_metrics
  (tenant_id,branch_id,business_date,menu_item_id,quantity_sold,net_revenue_minor,
   theoretical_cost_minor,contribution_minor,food_cost_bps,sales_mix_bps,classification,quality,
   quality_reasons_json,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'menu-demo-1',42,1680000,510000,1170000,
   3036,3590,'STAR','HIGH','[]',CURRENT_TIMESTAMP);

INSERT INTO inventory_gl_reconciliations
  (tenant_id,id,branch_id,warehouse_id,business_date,currency,subledger_value_minor,gl_value_minor,
   difference_minor,tolerance_minor,status,quality,evidence_json,calculated_at)
VALUES
  ('tenant-demo-mona','inventory-gl-demo','branch-demo-westlands','warehouse-demo-westlands',date('now'),
   'KES',6840000,6835000,5000,10000,'MATCHED','HIGH',
   '{"subledgerSource":"inventory movements","glSource":"posted journals"}',CURRENT_TIMESTAMP);

INSERT INTO management_actions
  (tenant_id,id,branch_id,action_type,severity,status,source_type,source_id,condition_key,business_date,
   metric_value,threshold_value,value_unit,evidence_json,assigned_user_id,assigned_role_id,
   first_detected_at,last_detected_at,resolved_at,resolution_actor_id,resolution_note,correlation_id,
   version,created_at,updated_at)
VALUES
  ('tenant-demo-mona','management-action-demo','branch-demo-westlands','FOOD_COST_ABOVE_TARGET','HIGH',
   'OPEN','DAILY_BRANCH_METRIC',date('now'),'demo-food-cost-above-target',date('now'),3365,3100,'BPS',
   '{"deepLink":"/finance","quality":"HIGH","driver":"recorded food cost"}',NULL,NULL,
   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL,NULL,NULL,'development-management-seed',1,
   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO close_readiness_snapshots
  (tenant_id,branch_id,business_date,status,blocker_count,warning_count,blockers_json,quality,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'NOT_READY',1,2,
   '[{"code":"OPEN_MANAGEMENT_ACTION","count":1,"severity":"HIGH"}]','HIGH',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','branch-demo-ngong-road',date('now'),'READY_TO_CLOSE',0,0,'[]','HIGH',CURRENT_TIMESTAMP);

INSERT INTO branch_health_snapshots
  (tenant_id,branch_id,business_date,status,evidence_json,quality,calculated_at)
VALUES
  ('tenant-demo-mona','branch-demo-westlands',date('now'),'WATCH',
   '[{"source":"management-action-demo","severity":"HIGH"}]','HIGH',CURRENT_TIMESTAMP),
  ('tenant-demo-mona','branch-demo-ngong-road',date('now'),'HEALTHY','[]','HIGH',CURRENT_TIMESTAMP);

INSERT INTO approval_inbox_items
  (tenant_id,source_type,source_id,branch_id,category,status,amount_minor,currency,requested_at,
   source_updated_at,payload_json,calculated_at)
VALUES
  ('tenant-demo-mona','PURCHASE_ORDER','purchase-order-demo','branch-demo-westlands','PROCUREMENT',
   'SUBMITTED',1250000,'KES',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
   '{"supplier":"Configured supplier"}',CURRENT_TIMESTAMP);

INSERT INTO branch_targets
  (tenant_id,id,branch_id,metric_code,target_value,value_unit,effective_from,effective_to,active,
   payload_json,created_by,created_at,updated_at)
VALUES
  ('tenant-demo-mona','target-demo-food-cost','branch-demo-westlands','FOOD_COST_BPS',3100,'BPS',
   date('now','-30 day'),NULL,1,'{}','development-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
