const project = "vnymbavsbxorwxpebkot";
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export function holdTargetPredicate(cutoff) {
  if (
    typeof cutoff !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(cutoff) ||
    !Number.isFinite(Date.parse(cutoff))
  )
    throw new Error("Invalid fixed hold cutoff");
  return `((status='RUNNING' AND NULLIF(lease_expires_at,'')::timestamptz<=${quote(cutoff)}::timestamptz) OR (status='DEAD_LETTER' AND NULLIF(updated_at,'')::timestamptz<=${quote(cutoff)}::timestamptz))`;
}
const fingerprint = `encode(sha256(convert_to(string_agg(jsonb_build_object('tenant',tenant_id,'job',id,'type',job_type,'status',status,'attempts',attempt_count,'max_attempts',max_attempts,'lease_owner',lease_owner,'lease_expires_at',lease_expires_at,'updated_at',updated_at,'payload_hash',md5(payload_json),'error_hash',md5(coalesce(last_error,'')))::text,chr(10) order by tenant_id,id),'UTF8')),'hex')`;
export function holdSnapshotSql(cutoff) {
  return `SELECT count(*)::integer AS jobs,${fingerprint} AS snapshot_sha256 FROM public.worker_jobs WHERE ${holdTargetPredicate(cutoff)}`;
}

export function buildStagingWorkerHoldSql({
  projectRef,
  cutoff,
  count,
  snapshotSha256,
  batchId,
  backupRun,
  backupRestoreVerified,
  operator,
  isolated = false,
}) {
  if (projectRef !== project || operator !== "Xmanuel01" || backupRestoreVerified !== true)
    throw new Error("Staging owner and verified restore are required");
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1000 ||
    !Number.isSafeInteger(backupRun) ||
    backupRun < 1
  )
    throw new Error("Invalid bounded hold plan");
  if (
    !/^[a-f0-9]{64}$/.test(snapshotSha256) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(batchId)
  )
    throw new Error("Invalid exact snapshot or batch identity");
  if (typeof isolated !== "boolean") throw new Error("Invalid isolated-test mode");
  const target = holdTargetPredicate(cutoff);
  return `BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='3min';
SELECT pg_advisory_xact_lock(32478965233706356::bigint);
DO $guard$ BEGIN
 IF current_database() NOT IN (${isolated ? "'seramet_test','seramet_restore'" : "'postgres'"}) THEN RAISE EXCEPTION 'Wrong staging/isolated database'; END IF;
 IF (SELECT max(version) FROM public.schema_migrations)<>30 THEN RAISE EXCEPTION 'Current schema required'; END IF;
 IF CURRENT_TIMESTAMP-${quote(cutoff)}::timestamptz<interval '20 minutes' THEN RAISE EXCEPTION 'Hold cutoff is too recent for an abandoned invocation'; END IF;
END $guard$;
DO $lock$ BEGIN PERFORM 1 FROM public.worker_jobs WHERE ${target} FOR UPDATE; END $lock$;
CREATE TEMP TABLE seramet_hold_before ON COMMIT DROP AS SELECT * FROM public.worker_jobs WHERE ${target};
DO $snapshot$ DECLARE actual_count integer; actual_sha text; BEGIN
 SELECT count(*)::integer,${fingerprint} INTO actual_count,actual_sha FROM seramet_hold_before;
 IF actual_count<>${count} OR actual_sha<>${quote(snapshotSha256)} THEN RAISE EXCEPTION 'Hold snapshot changed; no mutation approved'; END IF;
 IF EXISTS(SELECT 1 FROM seramet_hold_before WHERE jsonb_typeof(result_json::jsonb)<>'object' OR result_json::jsonb ? 'seramet_recovery_hold') THEN RAISE EXCEPTION 'Hold marker collision or invalid result JSON'; END IF;
END $snapshot$;
WITH held AS (
 UPDATE public.worker_jobs j SET status='FAILED',updated_at=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 result_json=(j.result_json::jsonb || jsonb_build_object('seramet_recovery_hold',jsonb_build_object(
 'version',1,'disposition','NO_REPLAY','batch_id',${quote(batchId)},'snapshot_sha256',${quote(snapshotSha256)},
 'original_status',j.status,'original_updated_at',j.updated_at,'approved_by',${quote(operator)},
 'applied_at',to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'backup_run',${backupRun})))::text
 FROM seramet_hold_before b WHERE j.tenant_id=b.tenant_id AND j.id=b.id
 RETURNING j.*
)
INSERT INTO public.audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,before_hash,after_hash,reason,correlation_id,metadata_json,created_at)
SELECT h.tenant_id,'staging-hold:'||${quote(batchId)}||':'||md5(h.id),h.branch_id,'owner:'||${quote(operator)},'WORKER_JOB_NO_REPLAY_HOLD','WORKER_JOB',h.id,
encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex'),
'Owner-approved historical staging no-replay hold; not successful completion',${quote(batchId)},
jsonb_build_object('snapshot_sha256',${quote(snapshotSha256)},'original_status',b.status,'backup_run',${backupRun})::text,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM held h JOIN seramet_hold_before b ON b.tenant_id=h.tenant_id AND b.id=h.id;
DO $verify$ BEGIN
 IF (SELECT count(*) FROM public.audit_events WHERE action='WORKER_JOB_NO_REPLAY_HOLD' AND correlation_id=${quote(batchId)})<>${count} THEN RAISE EXCEPTION 'Hold audit count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM seramet_hold_before b JOIN public.worker_jobs j ON j.tenant_id=b.tenant_id AND j.id=b.id
 WHERE j.status<>'FAILED' OR j.result_json::jsonb->'seramet_recovery_hold'->>'batch_id'<>${quote(batchId)}
 OR (to_jsonb(j)-'status'-'updated_at'-'result_json') IS DISTINCT FROM (to_jsonb(b)-'status'-'updated_at'-'result_json')
 OR (j.result_json::jsonb-'seramet_recovery_hold') IS DISTINCT FROM b.result_json::jsonb) THEN RAISE EXCEPTION 'Original job evidence changed'; END IF;
END $verify$;
COMMIT;`;
}
