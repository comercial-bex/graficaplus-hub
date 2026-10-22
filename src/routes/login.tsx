import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { NeonButton } from "@/components/bex/NeonButton";
import { ThemeToggle } from "@/components/bex/ThemeToggle";
import { CampoDeAcesso } from "@/components/acesso/CampoDeAcesso";
import { PainelDaMarca } from "@/components/acesso/PainelDaMarca";
import { mensagemErro } from "@/lib/erros";
import { destinoInterno } from "@/domain/acesso/destino-apos-login";
import {
  temErro,
  validarEntrada,
  type ErrosDaEntrada,
} from "@/domain/acesso/formulario-de-entrada";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — BEX PRINT OS" }] }),
  // `destino` é a tela que a pessoa tentou abrir sem estar logada (o QR da TV,
  // um link de aviso). Só caminho deste site passa; a chave vai sempre, mesmo
  // vazia, porque o roteador junta o valor cru da URL com o validado.
  // `como=parceiro` abre a aba do parceiro/terceirizado (a página /seja-parceiro
  // leva para cá). Qualquer outro valor é a equipe.
  validateSearch: (busca: Record<string, unknown>): { destino?: string; como?: "parceiro" } => ({
    destino: destinoInterno(busca.destino) ?? undefined,
    como: busca.como === "parceiro" ? "parceiro" : undefined,
  }),
  component: LoginPage,
});

/**
 * A tela de entrada: painel escuro da marca de um lado, formulário do outro.
 *
 * No celular vira uma coluna só (logo em cima, formulário embaixo) e a página
 * rola normalmente — nada de altura travada, para o teclado não cobrir o
 * campo. O erro aparece embaixo do campo a que se refere; o que o servidor
 * responde (senha errada, conta sem acesso) aparece embaixo do formulário e
 * também no aviso do canto, como sempre foi.
 */
function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  // Conferido de novo na hora de usar: é para cá que a senha certa leva.
  const busca = Route.useSearch();
  const destino = destinoInterno(busca.destino);
  // Quem entra: a equipe da gráfica ou um parceiro/terceirizado (22/10/2026).
  // A senha e a conta são as mesmas; muda o texto, o link de cadastro e o lugar
  // aonde se chega — o painel de parceiro mora em /parceiro, fora do sistema.
  const [como, setComo] = useState<"equipe" | "parceiro">(busca.como === "parceiro" ? "parceiro" : "equipe");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  // `email`/`senha` são o que faltou no campo; `geral` é a resposta do servidor.
  const [erros, setErros] = useState<ErrosDaEntrada & { geral?: string }>({});
  const campoEmail = useRef<HTMLInputElement>(null);
  const campoSenha = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    // Campo vazio ou e-mail pela metade não vai ao servidor: aponta o campo.
    const faltando = validarEntrada(email, password);
    if (temErro(faltando)) {
      setErros(faltando);
      (faltando.email ? campoEmail : campoSenha).current?.focus();
      return;
    }
    setErros({});
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      const mensagem = mensagemErro(error);
      setErros({ geral: mensagem });
      return toast.error(mensagem);
    }
    toast.success("Bem-vindo!");
    // Quem chegou por um link volta para ele; sem isso o código da TV lido pelo
    // QR se perdia no Início. `history.push` porque o destino já é um endereço
    // pronto, com a busca dentro.
    if (destino) router.history.push(destino);
    else if (como === "parceiro") navigate({ to: "/parceiro" });
    else navigate({ to: "/dashboard" });
  }

  async function handlePasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      const mensagem = "Digite seu e-mail primeiro para recuperar o acesso.";
      setErros({ email: mensagem });
      campoEmail.current?.focus();
      toast.error(mensagem);
      return;
    }

    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);

    if (error) return toast.error(mensagemErro(error));
    toast.success("Enviamos um link para você criar uma nova senha.");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:flex-row">
      <PainelDaMarca />

      <main className="relative flex flex-1 flex-col">
        {/* Tema do conteúdo: quem prefere o claro escolhe antes mesmo de entrar. */}
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12 sm:px-8 lg:py-16">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
            <div
              role="group"
              aria-label="Como você acessa"
              className="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1 text-sm"
            >
              {(
                [
                  ["equipe", "Sou da equipe"],
                  ["parceiro", "Sou parceiro ou terceirizado"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={como === valor}
                  onClick={() => {
                    setComo(valor);
                    setErros({});
                  }}
                  className={
                    como === valor
                      ? "rounded-md bg-background px-3 py-2 font-medium text-foreground shadow-sm"
                      : "rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {como === "parceiro"
                ? "Entre com o e-mail e a senha do seu cadastro de parceiro. Você cai direto no seu painel."
                : "Use o e-mail e a senha da sua conta na Bex Print."}
            </p>
          </header>

          {/* noValidate: a conferência é nossa, com a mensagem embaixo do campo. */}
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <CampoDeAcesso
              ref={campoEmail}
              id="login-email"
              rotulo="E-mail"
              type="email"
              inputMode="email"
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="voce@bexprint.com.br"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (erros.email) setErros((atual) => ({ ...atual, email: undefined }));
              }}
              erro={erros.email}
            />

            <CampoDeAcesso
              ref={campoSenha}
              id="login-senha"
              rotulo="Senha"
              type={mostrarSenha ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (erros.senha) setErros((atual) => ({ ...atual, senha: undefined }));
              }}
              erro={erros.senha}
              acao={
                // Olho: no balcão, com pressa, digitar senha às cegas erra.
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={mostrarSenha}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {mostrarSenha ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              }
            />

            {erros.geral && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-status-magenta/40 bg-status-magenta/10 px-3 py-2.5 text-sm text-status-magenta"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{erros.geral}</span>
              </div>
            )}

            {/* py-3 no span interno: a borda CMYK fica no botão, o texto no span */}
            <NeonButton
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full [&>span:last-child]:py-3"
            >
              {loading ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </NeonButton>

            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={resetLoading}
              className="block w-full rounded-md py-2 text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              {resetLoading ? "Enviando..." : "Recuperar acesso"}
            </button>
          </form>

          <p className="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
            {como === "parceiro" ? "Ainda não é parceiro?" : "Não tem uma conta?"}{" "}
            <Link
              to={como === "parceiro" ? "/seja-parceiro" : "/signup"}
              className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-bex-cyan"
            >
              {como === "parceiro" ? "Conheça a parceria" : "Solicitar registro"}
            </Link>
          </p>
        </div>

        {/* Só o que é verdade: nada de "servidor on" ou versão inventada. */}
        <footer className="px-6 pb-6 text-center text-xs text-muted-foreground">
          Bex Print · acesso restrito à equipe e aos parceiros da gráfica
        </footer>
      </main>
    </div>
  );
}
