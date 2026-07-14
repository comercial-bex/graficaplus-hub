import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BexBackground } from "@/components/bex/BexBackground";
import { BexLogo } from "@/components/bex/BexLogo";
import { NeonButton } from "@/components/bex/NeonButton";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Redefinir senha — BEX PRINT OS" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const canSubmit = useMemo(
    () => password.length >= 8 && password === confirmPassword && sessionReady,
    [confirmPassword, password, sessionReady],
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionReady(Boolean(data.session));
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setSessionReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error("Use uma senha com pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("As senhas não conferem.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) return toast.error(error.message);

    toast.success("Senha atualizada. Faça login novamente.");
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <BexBackground className="min-h-screen flex items-center justify-center p-6">
      <div className="relative w-full max-w-[440px]">
        <div className="mb-10 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-foreground">Redefinir senha</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie uma nova senha segura para acessar o sistema.
            </p>
          </div>

          {!checkingSession && !sessionReady ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-[color:var(--bex-yellow)]/30 bg-[color:var(--bex-yellow)]/10 p-4 text-sm text-muted-foreground">
                O link de recuperação expirou ou não foi aberto corretamente. Volte ao login,
                informe seu e-mail e solicite um novo link.
              </div>
              <Link
                to="/login"
                className="block text-center text-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
              >
                Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Nova senha
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-magenta)]/50 focus:ring-1 focus:ring-[color:var(--bex-magenta)]/30"
                />
              </div>

              <div className="space-y-2">
                <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Confirmar senha
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-cyan)]/50 focus:ring-1 focus:ring-[color:var(--bex-cyan)]/30"
                />
              </div>

              <NeonButton type="submit" disabled={loading || checkingSession || !canSubmit} className="w-full">
                {loading ? "SALVANDO..." : "SALVAR NOVA SENHA"}
              </NeonButton>
            </form>
          )}
        </div>
      </div>
    </BexBackground>
  );
}