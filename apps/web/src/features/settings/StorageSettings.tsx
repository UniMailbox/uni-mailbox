import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Database, HardDrive } from "lucide-react";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { apiRequest } from "../../lib/api";

interface InfrastructureStatus {
  required: {
    d1: "ok" | "missing" | "error";
    kv: "ok" | "missing" | "error";
    queue: "ok" | "missing" | "error";
    assets: "ok" | "missing" | "error";
  };
  attachments: {
    backend: "kv" | "r2";
    r2: "ok" | "missing" | "error";
    reason: string;
  };
}

export function StorageSettings() {
  const client = useQueryClient();
  const infrastructure = useQuery({
    queryKey: ["infrastructure-settings"],
    queryFn: () => apiRequest<InfrastructureStatus>("/admin/infrastructure"),
  });
  const verify = useMutation({
    mutationFn: () =>
      apiRequest<{ status: "verified"; backend: "r2" }>(
        "/admin/storage/r2/verify",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["infrastructure-settings"] }),
  });

  if (infrastructure.isLoading) {
    return <LoadingState label="Checking Cloudflare resources" />;
  }
  if (infrastructure.error || !infrastructure.data) {
    return (
      <ErrorState
        error={infrastructure.error}
        retry={() => void infrastructure.refetch()}
      />
    );
  }
  const { required, attachments } = infrastructure.data;

  return (
    <div className="configuration-stack">
      <section className="settings-card vertical">
        <div className="card-heading">
          <div>
            <span className="card-index">Required infrastructure</span>
            <h2>Runtime foundation</h2>
          </div>
          <Database />
        </div>
        <p>
          D1, KV, Queue, and Assets are provisioned with the deployment. Mail
          storage remains operational on KV when no R2 binding is present.
        </p>
        <div className="resource-grid">
          {Object.entries(required).map(([name, status]) => (
            <div className={`resource-tile ${status}`} key={name}>
              <span>{name === "d1" ? "D1" : name.toUpperCase()}</span>
              <strong>
                {status === "ok" ? (
                  <>
                    <CheckCircle2 /> Ready
                  </>
                ) : (
                  status
                )}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card storage-card">
        {attachments.backend === "r2" ? <Archive /> : <HardDrive />}
        <div>
          <div className="card-heading">
            <div>
              <span className="card-index">Attachment backend</span>
              <h2>
                {attachments.backend === "r2"
                  ? "R2 object storage"
                  : "KV storage is active"}
              </h2>
            </div>
            <span
              className={`checkpoint-status ${
                attachments.backend === "r2" ? "configured" : "verified"
              }`}
            >
              <span aria-hidden="true" />
              {attachments.backend === "r2" ? "R2 bound" : "KV healthy"}
            </span>
          </div>
          <p>{attachments.reason}</p>
          {attachments.backend === "kv" ? (
            <>
              <div className="operator-instruction">
                <strong>R2 is optional</strong>
                <span>
                  Add an <code>ATTACHMENTS</code> R2 binding in Cloudflare,
                  deploy with <code>wrangler.r2.jsonc</code>, then return here
                  to verify. Existing KV objects remain readable during
                  migration.
                </span>
              </div>
              <button className="button secondary" disabled type="button">
                Verify R2 write access
              </button>
            </>
          ) : (
            <button
              className="button primary"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
              type="button"
            >
              Verify R2 write access
            </button>
          )}
          {verify.error ? <ErrorState error={verify.error} /> : null}
          {verify.isSuccess ? (
            <SuccessNote>R2 write, head, and cleanup probe passed.</SuccessNote>
          ) : null}
        </div>
      </section>
    </div>
  );
}
