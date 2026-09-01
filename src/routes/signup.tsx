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

/** Em palavras da gráfica, não em nome de papel do sistema. */
const FUNCOES = [
  { valor: "vendedor", rotulo: "Vendas e atendimento" },
  { valor: "designer", rotulo: "Design e arte-final" },
  { valor: "operador", rotulo: "Impressão e operação de máquina" },
  { valor: "estoque", rotulo: "Almoxarifado e estoque" },
  { valor: "instalador", rotulo: "Entrega e instalação" },
  { valor: "financeiro", rotulo: "Financeiro" },
  { valor: "gestor", rotulo: "Gerência" },
  { valor: "administrador", rotulo: "Administração do sistema" },
];

function SignupPage() {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cargo, setCargo] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    if (!cargo) {
      setLoading(false);
      return toast.error("Escolha o que você faz — é o que o administrador usa para liberar seu acesso.");
    }
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { nome: nome.trim(), telefone: telefone.trim(), cargo_pretendido: cargo },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    // Não manda para /dashboard: sem papel, o guarda é deny-by-default e a pessoa
    // veria "Acesso restrito" logo depois de criar a conta com sucesso.
    setEnviado(true);
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-cyan)]/50 focus:ring-1 focus:ring-[color:var(--bex-cyan)]/30";

  if (enviado) {
    return (
      <BexBackground className="min-h-screen flex items-center justify-center p-6">
        <div className="relative w-full max-w-[420px]">
          <div className="mb-10 flex flex-col items-center">
            <BexLogo size="xl" showTagline />
          </div>
          <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">Cadastro enviado</h1>
            <p className="text-sm text-muted-foreground">
              Sua conta foi criada como <strong className="text-foreground">{cargo}</strong>. Falta
              o administrador liberar o acesso — normalmente é rápido. Você vai entrar com o
              e-mail e a senha que acabou de escolher.
            </p>
            <p className="text-sm text-muted-foreground">
              Se o sistema pedir confirmação de e-mail, confira sua caixa de entrada antes.
            </p>
            <Link
              to="/login"
              className="inline-block pt-2 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
            >
              Voltar para o login
            </Link>
          </div>
        </div>
      </BexBackground>
    );
  }

  return (
    <BexBackground className="min-h-screen flex items-center justify-center p-6">
      <div className="relative w-full max-w-[420px]">
        <div className="mb-10 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-foreground">Criar sua conta</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Você se cadastra aqui e o administrador libera o que você pode ver
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
            <div className="space-y-2">
              <label className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Telefone / WhatsApp
              </label>
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputCls} placeholder="(96) 99111-6169" />
            </div>
            <div className="space-y-2">
              <label htmlFor="cargo" className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                O que você faz na gráfica
              </label>
              {/* É a informação que o administrador usa para escolher o perfil.
                  Sem ela ele recebe um e-mail solto e precisa adivinhar. */}
              <select id="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} required className={inputCls}>
                <option value="">Selecione…</option>
                {FUNCOES.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.rotulo}</option>
                ))}
              </select>
              <p className="px-1 text-[11px] text-muted-foreground/80">
                Isto é só uma indicação — quem decide o acesso é o administrador.
              </p>
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
