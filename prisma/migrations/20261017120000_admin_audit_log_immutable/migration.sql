-- Admin audit rows (role grants, deactivations, onboarding) are as immutable as change
-- audit rows: ISO 27001 A.8.15. The message now names whichever table was touched.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (ISO 27001 A.8.15)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- Row triggers don't fire on TRUNCATE, which empties a table in one statement.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON "AdminAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();
