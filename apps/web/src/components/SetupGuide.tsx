import type { SetupState, SetupTaskId } from "../setup";
import { setupCompletionPercentage } from "../setup";
import { ClipboardCheck, DatabaseZap, GitBranch, Rocket, ServerCog } from "lucide-react";

type SetupGuideProps = {
  setup: SetupState;
  onChange: (setup: SetupState) => void;
};

const tasks: Array<{
  id: SetupTaskId;
  title: string;
  detail: string;
}> = [
  {
    id: "cloudflareResources",
    title: "Create Cloudflare resources",
    detail: "Create D1, KV, R2, one Worker, and one Pages project in the target account."
  },
  {
    id: "wranglerBindings",
    title: "Fill Wrangler bindings",
    detail: "Replace placeholder ids in apps/api/wrangler.toml with the generated Cloudflare ids."
  },
  {
    id: "githubSettings",
    title: "Set GitHub deployment settings",
    detail: "Add CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_PAGES_PROJECT_NAME."
  },
  {
    id: "d1Migrations",
    title: "Apply D1 migrations",
    detail: "Run local migrations during development and remote migrations before production deploy."
  },
  {
    id: "firstDeploy",
    title: "Run first deploy",
    detail: "Push to main or run the Deploy workflow manually from GitHub Actions."
  }
];

export function SetupGuide({ setup, onChange }: SetupGuideProps) {
  const completion = setupCompletionPercentage(setup);

  function updateField(field: keyof Omit<SetupState, "completed">, value: string) {
    onChange({ ...setup, [field]: value });
  }

  function toggleTask(taskId: SetupTaskId) {
    onChange({
      ...setup,
      completed: {
        ...setup.completed,
        [taskId]: !setup.completed[taskId]
      }
    });
  }

  return (
    <section className="setup-board" aria-labelledby="setup-title">
      <div className="setup-summary">
        <div>
          <p className="eyebrow">Initial setup</p>
          <h2 id="setup-title">Wire Cloudflare resources before the first production deploy.</h2>
        </div>
        <div className="progress-meter" aria-label={`Setup ${completion}% complete`}>
          <span>{completion}%</span>
          <div>
            <i style={{ width: `${completion}%` }} />
          </div>
        </div>
      </div>

      <div className="setup-grid">
        <div className="setup-fields">
          <label>
            <span>Worker API URL</span>
            <input
              onChange={(event) => updateField("apiBaseUrl", event.target.value)}
              placeholder="https://cf-startup-api.example.workers.dev"
              type="url"
              value={setup.apiBaseUrl}
            />
          </label>
          <label>
            <span>Pages project</span>
            <input
              onChange={(event) => updateField("pagesProjectName", event.target.value)}
              placeholder="cf-startup-web"
              value={setup.pagesProjectName}
            />
          </label>
          <label>
            <span>D1 database</span>
            <input
              onChange={(event) => updateField("d1DatabaseName", event.target.value)}
              value={setup.d1DatabaseName}
            />
          </label>
          <label>
            <span>KV namespace id</span>
            <input
              onChange={(event) => updateField("kvNamespaceId", event.target.value)}
              placeholder="Generated namespace id"
              value={setup.kvNamespaceId}
            />
          </label>
          <label>
            <span>R2 bucket</span>
            <input
              onChange={(event) => updateField("r2BucketName", event.target.value)}
              value={setup.r2BucketName}
            />
          </label>
          <p className="setup-note">API tokens stay in GitHub Secrets and are not stored here.</p>
        </div>

        <div className="setup-tasks">
          {tasks.map((task, index) => {
            const Icon = [ServerCog, DatabaseZap, GitBranch, ClipboardCheck, Rocket][index];

            return (
              <button
                className={setup.completed[task.id] ? "setup-task done" : "setup-task"}
                key={task.id}
                onClick={() => toggleTask(task.id)}
                type="button"
              >
                <Icon />
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
