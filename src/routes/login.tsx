import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BexLogo } from "@/components/bex/BexLogo";
import { BexBackground } from "@/components/bex/BexBackground";
import { NeonButton } from "@/components/bex/NeonButton";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — BEX PRINT OS" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo!");
    navigate({ to: "/dashboard" });
  }

  async function handlePasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("Digite seu e-mail primeiro para recuperar o acesso.");
      return;
    }

    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);

    if (error) return toast.error(error.message);
    toast.success("Enviamos um link para você criar uma nova senha.");
  }

  return (
    <BexBackground className="min-h-screen flex items-center justify-center p-6">
      <div className="relative w-full max-w-[420px]">
        {/* Brand */}
        <div className="mb-10 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-foreground">Acesso ao Sistema</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Controle de Produção, Comercial e Financeiro
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Usuário
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="voce@bexprint.com.br"
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-cyan)]/50 focus:ring-1 focus:ring-[color:var(--bex-cyan)]/30"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={resetLoading}
                  className="text-[11px] text-muted-foreground hover:text-[color:var(--bex-cyan)] transition-colors"
                >
                  {resetLoading ? "Enviando..." : "Recuperar acesso"}
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-magenta)]/50 focus:ring-1 focus:ring-[color:var(--bex-magenta)]/30"
              />
            </div>

            <NeonButton type="submit" disabled={loading} className="w-full">
              {loading ? "AUTENTICANDO..." : "ENTRAR NO SISTEMA"}
            </NeonButton>
          </form>

          <div className="mt-8 border-t border-border/50 pt-6 text-center">
            <p className="text-xs text-muted-foreground">
              Não tem uma conta?{" "}
              <Link
                to="/signup"
                className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-lime)]"
              >
                Solicitar registro
              </Link>
            </p>
          </div>
        </div>

        {/* Telemetria footer */}
        <div className="mt-8 flex justify-center gap-6 font-mono text-[10px] text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--bex-lime)]" />
            SERVER_ON
          </span>
          <span>V 4.2.0</span>
          <span>SECURE_AUTH</span>
        </div>
      </div>
    </BexBackground>
  );
}
