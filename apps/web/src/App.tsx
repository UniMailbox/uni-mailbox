import type { Profile, Role, StoredFile } from "@cf-startup/shared";
import { Cloud, Database, FileUp, KeyRound, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { PermissionGate } from "./components/PermissionGate";
import { RoleSwitcher } from "./components/RoleSwitcher";
import { useApi } from "./hooks/useApi";

const userId = "local-user";

export function App() {
  const [role, setRole] = useState<Role>("viewer");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [configValue, setConfigValue] = useState("launch-dark");
  const profiles = useApi<Profile[]>();
  const createProfile = useApi<Profile>();
  const files = useApi<StoredFile[]>();
  const uploadFile = useApi<StoredFile>();
  const [notice, setNotice] = useState("");

  const requestOptions = useMemo(() => ({ role, userId }), [role]);

  useEffect(() => {
    void profiles.run(() => api.profiles(requestOptions));
    void files.run(() => api.files(requestOptions));
  }, [files.run, profiles.run, requestOptions]);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await createProfile.run(() =>
      api.createProfile(requestOptions, {
        displayName,
        title
      })
    );

    if (created) {
      setDisplayName("");
      setTitle("");
      setNotice("Profile written to D1.");
      await profiles.run(() => api.profiles(requestOptions));
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      return;
    }

    const uploaded = await uploadFile.run(() => api.uploadFile(requestOptions, file));
    if (uploaded) {
      setNotice("File uploaded to R2 and indexed in D1.");
      event.currentTarget.reset();
      await files.run(() => api.files(requestOptions));
    }
  }

  async function saveConfig() {
    const saved = await api.setConfig(requestOptions, "theme", configValue);
    setNotice(saved.ok ? "KV config updated." : saved.error.message);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Cloudflare stack starter</p>
          <h1>Worker API, Pages UI, D1, KV, R2, and shared RBAC.</h1>
        </div>
        <div className="identity-panel">
          <span>Acting as</span>
          <RoleSwitcher role={role} onChange={setRole} />
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}

      <section className="resource-grid" aria-label="Cloudflare resources">
        <article>
          <Database />
          <h2>D1 profiles</h2>
          <p>Parameterized reads and writes through Worker routes.</p>
        </article>
        <article>
          <KeyRound />
          <h2>KV config</h2>
          <p>Admin-only runtime settings for lightweight configuration.</p>
        </article>
        <article>
          <FileUp />
          <h2>R2 files</h2>
          <p>Editor uploads land in object storage with D1 metadata.</p>
        </article>
        <article>
          <ShieldCheck />
          <h2>RBAC</h2>
          <p>Backend middleware and frontend gates share one permission map.</p>
        </article>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-header">
            <Cloud />
            <h2>Profiles</h2>
          </div>

          <PermissionGate
            role={role}
            permission="profile:write"
            fallback={<p className="muted">Switch to editor or admin to create profiles.</p>}
          >
            <form className="stack-form" onSubmit={submitProfile}>
              <input
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Display name"
                required
                value={displayName}
              />
              <input
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title"
                required
                value={title}
              />
              <button type="submit">Create profile</button>
            </form>
          </PermissionGate>

          {profiles.error && <p className="error">{profiles.error.message}</p>}
          <div className="list">
            {(profiles.data ?? []).map((profile) => (
              <div className="row" key={profile.id}>
                <strong>{profile.displayName}</strong>
                <span>{profile.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <FileUp />
            <h2>Files and config</h2>
          </div>

          <PermissionGate
            role={role}
            permission="file:write"
            fallback={<p className="muted">Switch to editor or admin to upload files.</p>}
          >
            <form className="stack-form" onSubmit={upload}>
              <input name="file" type="file" />
              <button type="submit">Upload to R2</button>
            </form>
          </PermissionGate>

          <PermissionGate
            role={role}
            permission="config:manage"
            fallback={<p className="muted">KV config is admin-only.</p>}
          >
            <div className="stack-form">
              <input
                onChange={(event) => setConfigValue(event.target.value)}
                value={configValue}
              />
              <button onClick={saveConfig} type="button">
                Save KV config
              </button>
            </div>
          </PermissionGate>

          {files.error && <p className="error">{files.error.message}</p>}
          <div className="list">
            {(files.data ?? []).map((file) => (
              <div className="row" key={file.key}>
                <strong>{file.filename}</strong>
                <span>{Math.ceil(file.size / 1024)} KB</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
