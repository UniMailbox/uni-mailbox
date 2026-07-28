import { ArrowRight, LockKeyhole, Radio } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiRequest, jsonBody, setAccessToken } from "../../lib/api";
import { navigate } from "../../lib/navigation";
import { ErrorState } from "../../components/Status";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
});

export function LoginPage() {
  const form = useForm<z.infer<typeof loginSchema>>();
  const login = useMutation({
    mutationFn: async (values: z.infer<typeof loginSchema>) =>
      apiRequest<{ accessToken: string }>("/auth/login", {
        method: "POST",
        body: jsonBody(loginSchema.parse(values)),
      }),
    onSuccess: (result) => {
      setAccessToken(result.accessToken);
      navigate("/inbox");
    },
  });

  return (
    <main className="auth-page">
      <section className="auth-signal" aria-hidden="true">
        <div className="signal-grid" />
        <div className="signal-copy">
          <Radio />
          <p>ROUTING STATUS</p>
          <strong>Awaiting operator</strong>
        </div>
      </section>
      <section className="auth-panel">
        <a className="wordmark" href="/login">
          <span>CM</span> UniMailbox
        </a>
        <div className="auth-form-wrap">
          <div className="section-kicker">Secure operator access</div>
          <h1>Sign in to your mail plane.</h1>
          <p className="lede">
            Credentials stay inside your Cloudflare deployment. Refresh sessions
            use an HTTP-only, same-site cookie.
          </p>
          <form
            className="form-stack"
            onSubmit={form.handleSubmit((values) => login.mutate(values))}
          >
            <label className="field">
              <span>Email address</span>
              <input
                {...form.register("email", { required: true })}
                autoComplete="email"
                inputMode="email"
                placeholder="operator@example.com"
                type="email"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                {...form.register("password", {
                  required: true,
                  minLength: 12,
                })}
                autoComplete="current-password"
                type="password"
              />
            </label>
            {login.error ? <ErrorState error={login.error} /> : null}
            <button
              className="button primary auth-submit"
              disabled={login.isPending}
            >
              <LockKeyhole aria-hidden="true" />
              {login.isPending ? "Signing in…" : "Enter workspace"}
              <ArrowRight aria-hidden="true" />
            </button>
          </form>
        </div>
        <footer>UniMailbox · private infrastructure · no shared tenancy</footer>
      </section>
    </main>
  );
}
