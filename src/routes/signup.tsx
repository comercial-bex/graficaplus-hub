import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BexLogo } from "@/components/bex/BexLogo";
import { BexBackground } from "@/components/bex/BexBackground";
import { NeonButton } from "@/components/bex/NeonButton";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Criar conta — BEX PRINT OS" }] }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { nome },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Você já pode entrar.");
    navigate({ to: "/dashboard" });
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-cyan)]/50 focus:ring-1 focus:ring-[color:var(--bex-cyan)]/30";

  return (
    <BexBackground className="min-h-screen flex items-center justify-center p-6">
      <div className="relative w-full max-w-[420px]">
        <div className="mb-10 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-foreground">Solicitar registro</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              O primeiro usuário vira administrador do sistema
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Nome completo
              </label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} required className={inputCls} placeholder="Seu nome" />
            </div>
            <div className="space-y-2">
              <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                E-mail corporativo
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} placeholder="voce@bexprint.com.br" />
            </div>
            <div className="space-y-2">
              <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Senha
              </label>
              <input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} placeholder="Mínimo 6 caracteres" />
            </div>
            <NeonButton type="submit" disabled={loading} className="w-full">
              {loading ? "CRIANDO..." : "CRIAR CONTA"}
            </NeonButton>
          </form>

          <div className="mt-8 border-t border-border/50 pt-6 text-center">
            <p className="text-xs text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/login" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]">
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </div>
    </BexBackground>
  );
}
