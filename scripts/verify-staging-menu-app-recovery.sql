-- INDEPENDENT READ-ONLY VERIFICATION, staging-only.
-- Run with psql against the STAGING project after the alternative quarantine.
-- A FALSE result is a release blocker; never mutate data based only on this query.
WITH incident(id, expected_reason) AS (
  VALUES
    ('53dc7989-e0c9-4b01-9f47-119b6bbde582','SUPERSEDED_V1_TEMPLATE'),
    ('6422bec8-d19f-405c-af8d-9f280080e978','CANONICAL_V3_REFERENCE_ONLY_REQUIRES_FRESH_MALWARE_SCAN'),
    ('74950938-5153-4903-817b-830e24178aa2','EXACT_V3_DUPLICATE')
), expected AS (
  SELECT '64d00226-45e6-48eb-b43f-972061e7abac'::text AS tenant_id,
    '95e5c05d8fd0d421dc5eba7ceca49e914e72d46a62cfecac7563677512bb1b43'::text AS archive_sha,
    'a7fb93005c0176decfcb3e94152d39a96ae17da35ba6bcff017ad8a7059c3481'::text AS plan_sha
), observations AS (
  SELECT
    (SELECT COUNT(*) FROM public.setup_imports i
     JOIN incident t ON t.id=i.id CROSS JOIN expected e
     WHERE i.tenant_id=e.tenant_id AND i.status='REJECTED'
       AND i.verification_status='FAILED' AND i.committed_at IS NULL
       AND i.report_json::jsonb->'incidentRecovery'->>'disposition'=t.expected_reason
       AND i.report_json::jsonb->'incidentRecovery'->>'sourceArchiveSha256'=e.archive_sha
       AND i.report_json::jsonb->'incidentRecovery'->>'planSha256'=e.plan_sha) AS quarantined_imports,
    (SELECT COUNT(*) FROM public.worker_jobs j
     JOIN incident t ON j.payload_json::jsonb->>'importId'=t.id CROSS JOIN expected e
     WHERE j.tenant_id=e.tenant_id AND j.job_type='SETUP_IMPORT_COMMIT'
       AND j.status='DEAD_LETTER' AND j.attempt_count=0
       AND j.started_at IS NULL AND j.lease_owner IS NULL) AS quarantined_jobs,
    (SELECT COUNT(*) FROM public.setup_import_rows r
     JOIN incident t ON r.import_id=t.id CROSS JOIN expected e
     WHERE r.tenant_id=e.tenant_id AND r.status IN ('VALID','WARNING')
       AND r.committed_entity_id IS NULL AND r.committed_entity_type IS NULL) AS preserved_rows,
    (SELECT COUNT(*) FROM public.audit_events a JOIN incident t ON a.entity_id=t.id
     CROSS JOIN expected e WHERE a.tenant_id=e.tenant_id
       AND a.entity_type='SETUP_IMPORT' AND a.action='SETUP_IMPORT_QUARANTINED'
       AND a.reason=t.expected_reason
       AND a.metadata_json::jsonb->>'sourceArchiveSha256'=e.archive_sha
       AND a.metadata_json::jsonb->>'planSha256'=e.plan_sha
       AND a.metadata_json::jsonb->>'recoveryScope'='APPLICATION_PUBLIC_SCHEMA_ONLY') AS audit_events,
    (SELECT COUNT(*) FROM public.menu_catalog_items) AS menu_items,
    (SELECT COUNT(*) FROM public.worker_jobs
     WHERE job_type='MANAGEMENT_INTELLIGENCE_RECALCULATION' AND status='PENDING') AS unrelated_pending_jobs,
    (SELECT COUNT(*) FROM public.setup_imports WHERE import_kind='MENU') AS all_menu_imports,
    (SELECT COUNT(*) FROM public.setup_import_rows) AS all_preview_rows
)
SELECT *,
  (quarantined_imports=3 AND quarantined_jobs=3 AND preserved_rows=1029
    AND audit_events=3 AND menu_items=8 AND unrelated_pending_jobs=41
    AND all_menu_imports=10 AND all_preview_rows=3088) AS independent_verification_pass
FROM observations;
