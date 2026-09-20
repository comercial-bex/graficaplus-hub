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
 * Três coisas que esta tela NÃO faz, de propósito:
 *
 * - não libera acesso: o cadastro nasce `pendente` e sem papel nenhum. Quem
 *   entra por um link não pode ver preço de revenda — que é 15% a 30% abaixo
 *   do balcão e revela a estrutura de custo da gráfica — antes de alguém da
 *   Bex Print olhar quem é. A liberação é na tela de Parceiros.
 * - não mostra preço, catálogo ou dado de outro parceiro.
 * - não diz se o código existe antes de ser digitado por inteiro, e nunca
 *   devolve id de ninguém — só o nome de quem convidou.
 */

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
      if (error) throw error;
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
            className="inline-block pt-2 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
          >
            Ir para o login
          </Link>
        </div>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura>
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold text-foreground">Cadastro enviado</h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo, <strong className="text-foreground">{empresa.trim()}</strong>. Seu cadastro
            de revendedor chegou à Bex Print e está aguardando liberação — normalmente é rápido.
          </p>
          <p className="text-sm text-muted-foreground">
            Assim que for liberado, você entra com o e-mail e a senha que acabou de escolher, e já
            recebe o <strong className="text-foreground">seu próprio link de convite</strong> para
            indicar outros revendedores.
          </p>
          <Link
            to="/login"
            className="inline-block pt-2 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-[color:var(--bex-cyan)]"
          >
            Ir para o login
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
          empresa abaixo — a Bex Print libera o acesso depois de conferir.
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
