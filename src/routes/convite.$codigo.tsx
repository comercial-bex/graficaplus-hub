import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BexLogo } from "@/components/bex/BexLogo";
import { BexBackground } from "@/components/bex/BexBackground";
import { NeonButton } from "@/components/bex/NeonButton";
import { mensagemErro } from "@/lib/erros";

/**
 * Cadastro de revendedor por convite de outro revendedor.
 *
 * O laço é o do começo das redes sociais: cada parceiro tem um link só dele e
 * manda para quem quiser; quem entra por ali fica ligado a quem convidou, e
 * esse vínculo é o que permite pagar o bônus de indicação depois.
 *
 * Duas coisas que esta tela NÃO faz, de propósito:
 *
 * - não pede aprovação: desde 23/10/2026 o cadastro já nasce `ativo` e com o
 *   papel de parceiro (decisão do dono: quem se inscreve entra e pede na hora).
 *   O controle é depois: a equipe suspende quem não deve ficar, na aba
 *   "Parceiros e terceirizados" de Equipe e acessos.
 * - não mostra preço, catálogo ou dado de outro parceiro.
 * - não diz se o código existe antes de ser digitado por inteiro, e nunca
 *   devolve id de ninguém — só o nome de quem convidou.
 */

/** Erro do cadastro em português claro: o da biblioteca vem em inglês e não diz o que fazer. */
function erroDoCadastro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered")) return "Este e-mail já tem cadastro. Entre pela tela de login (aba parceiro).";
  if (m.includes("password") && (m.includes("weak") || m.includes("pwned") || m.includes("least")))
    return "Escolha uma senha mais forte: 8 ou mais caracteres, misturando letras e números.";
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (m.includes("invalid") && m.includes("email")) return "Confira o e-mail digitado.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled"))
    return "O cadastro está indisponível agora. Fale com a Bex Print pelo WhatsApp.";
  return msg;
}

export const Route = createFileRoute("/convite/$codigo")({
  head: () => ({ meta: [{ title: "Convite de parceiro — BEX PRINT" }] }),
  component: ConvitePage,
});

const inputCls =
  "w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[color:var(--bex-cyan)]/50 focus:ring-1 focus:ring-[color:var(--bex-cyan)]/30";

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <BexBackground className="min-h-screen flex items-center justify-center p-6">
      <div className="relative w-full max-w-[460px]">
        <div className="mb-8 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          {children}
        </div>
      </div>
    </BexBackground>
  );
}

function ConvitePage() {
  const { codigo } = Route.useParams();

  const convite = useQuery({
    queryKey: ["convite", codigo],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("convite_de_parceiro", {
        p_codigo: codigo,
      });
      if (error) throw error;
      const linha = (data ?? [])[0] as { valido: boolean; convidado_por: string } | undefined;
      return linha ?? null;
    },
  });

  const [empresa, setEmpresa] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!empresa.trim()) return toast.error("Diga o nome da sua empresa.");
    if (senha.length < 6) return toast.error("A senha precisa de pelo menos 6 caracteres.");

    setEnviando(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { nome: empresa.trim(), telefone: telefone.trim() },
        },
      });
      if (error) throw new Error(erroDoCadastro(error.message));
      // E-mail já cadastrado: o Supabase não erra, devolve um usuário sem identidades.
      if (data.user && (data.user.identities ?? []).length === 0) {
        throw new Error("Este e-mail já tem cadastro. Entre pela aba \"Sou parceiro ou terceirizado\" na tela de login (ou use \"esqueci a senha\").");
      }
      const usuarioId = data.user?.id;
      if (!usuarioId) throw new Error("O cadastro não retornou a conta criada.");

      const { error: erroRpc } = await (supabase.rpc as any)("parceiro_cadastrar_por_convite", {
        p_codigo: codigo,
        p_usuario_id: usuarioId,
        p_marca_nome: empresa.trim(),
        p_documento: documento.trim() || null,
        p_telefone: telefone.trim() || null,
        p_email: email.trim().toLowerCase() || null,
        p_cidade: cidade.trim() || null,
        p_estado: estado.trim().toUpperCase() || null,
      });
      // A conta já existe neste ponto. Se o vínculo falhar, a pessoa precisa
      // saber que a senha dela vale — e a gráfica precisa saber que houve uma
      // conta órfã, em vez de um cadastro que "sumiu".
      if (erroRpc) {
        throw new Error(
          `Sua conta foi criada, mas o vínculo com o convite falhou: ${erroRpc.message}. ` +
            `Fale com a Bex Print informando o e-mail que você usou.`,
        );
      }

      setPronto(true);
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  if (convite.isLoading) {
    return (
      <Moldura>
        <p className="text-center text-sm text-muted-foreground">Conferindo o convite...</p>
      </Moldura>
    );
  }

  if (!convite.data) {
    return (
      <Moldura>
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold text-foreground">Convite não encontrado</h1>
          <p className="text-sm text-muted-foreground">
            Este link não está mais valendo, ou foi digitado com algum caractere trocado. Peça um
            link novo a quem te indicou.
          </p>
          <Link
            to="/login"
            search={{ como: "parceiro" }}
            className="inline-block pt-2 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
          >
            Entrar no meu painel
          </Link>
        </div>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura>
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold text-foreground">Cadastro feito — acesso liberado</h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo, <strong className="text-foreground">{empresa.trim()}</strong>. Seu cadastro
            de revendedor está pronto e o seu painel já está liberado.
          </p>
          <p className="text-sm text-muted-foreground">
            Entre com o e-mail e a senha que acabou de escolher (se pedirmos a confirmação do
            e-mail, confirme primeiro). Lá você já recebe o <strong className="text-foreground">seu próprio link de convite</strong> para
            indicar outros revendedores.
          </p>
          <Link
            to="/login"
            search={{ como: "parceiro" }}
            className="inline-block pt-2 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
          >
            Entrar no meu painel
          </Link>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="mb-6 space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--bex-cyan)]">
          Convite de parceiro
        </p>
        <h1 className="text-xl font-semibold text-foreground">
          {convite.data.convidado_por} te indicou para o clube de revendedores
        </h1>
        <p className="text-sm text-muted-foreground">
          Preço de revendedor, orçamento com a sua marca e crédito a cada compra. Cadastre sua
          empresa abaixo — o acesso ao painel é liberado na hora.
        </p>
      </div>

      <form onSubmit={enviar} className="space-y-3">
        <input
          className={inputCls}
          placeholder="Nome da sua empresa *"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          required
          autoFocus
        />
        <input
          className={inputCls}
          placeholder="CNPJ ou CPF"
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            className={inputCls}
            placeholder="Cidade"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="UF"
            maxLength={2}
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          />
        </div>
        <input
          className={inputCls}
          placeholder="WhatsApp"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
        <input
          className={inputCls}
          type="email"
          placeholder="Seu e-mail *"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder="Crie uma senha *"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          minLength={6}
        />

        <NeonButton type="submit" className="w-full justify-center" disabled={enviando}>
          {enviando ? "Enviando..." : "Quero ser revendedor"}
        </NeonButton>

        <p className="pt-1 text-center text-xs text-muted-foreground">
          Sem taxa de adesão e sem compra obrigatória.
        </p>
      </form>
    </Moldura>
  );
}
