import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgePercent, FileText, Gift, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CampoDeAcesso } from "@/components/acesso/CampoDeAcesso";
import { BANNER_DO_CONVITE, LOGO_FUNDO_ESCURO } from "@/lib/marca";
import { mensagemErro } from "@/lib/erros";
import { cadastroParceiroConcluidoMeta, lerOrigemDaUrl, META_PIXEL_ID } from "@/lib/metaPixel";
import {
  CHAVE_CADASTRO_PENDENTE,
  gerarSenhaProvisoria,
  mascaraWhatsapp,
  sugerirEmail,
  validarCadastroRapido,
} from "@/domain/parceiros/cadastro-rapido";

/**
 * No tema escuro os tokens de campo e de cartão são a mesma cor (#0d0d0d): um
 * campo vazio e sem placeholder sumia dentro do cartão. Aqui o campo fica no
 * fundo da página (bg-background) com a borda comum, visível nos dois temas.
 */
const campoCls = "border-border bg-background";

/**
 * Cadastro de parceiro por convite de outro parceiro.
 *
 * O laço é o do começo das redes sociais: cada parceiro tem um link só dele e
 * manda para quem quiser; quem entra por ali fica ligado a quem convidou, e
 * esse vínculo é o que permite pagar o bônus de indicação depois.
 *
 * A página roda no Instagram e em link direto (02/11/2026): por isso é escura
 * da marca nos dois temas (tokens da barra lateral, como a tela de entrada),
 * leva o banner da campanha e tem os dados do link (og:image) para a prévia
 * sair com o banner quando o link é colado numa conversa.
 *
 * TRÊS CAMPOS (03/11/2026, decisão do dono): nome, WhatsApp e e-mail. A senha é
 * provisória, gerada aqui, e vai pelo WhatsApp junto com o link e o e-mail; o
 * resto do cadastro (ramo, comprovação, cidade, documento) e a senha
 * definitiva são pedidos no primeiro acesso ao painel (CompletarCadastro). Um
 * formulário de nove campos dentro do Instagram perdia gente no meio.
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
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (m.includes("invalid") && m.includes("email")) return "Confira o e-mail digitado.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled"))
    return "O cadastro está indisponível agora. Fale com a Bex Print pelo WhatsApp.";
  return msg;
}

const DESCRICAO = "Preço de parceiro, orçamento com a sua marca e crédito a cada compra. Cadastre-se em 30 segundos e o painel é liberado na hora.";

export const Route = createFileRoute("/convite/$codigo")({
  head: () => ({
    meta: [
      { title: "Seja parceiro — BEX PRINT" },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: "Seja parceiro da Bex Print" },
      { property: "og:description", content: DESCRICAO },
      { name: "twitter:description", content: DESCRICAO },
      { property: "og:image", content: `https://bexprint.com.br${BANNER_DO_CONVITE}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConvitePage,
});

/** O que o parceiro ganha, em três linhas: é o argumento da página, acima do formulário. */
const GANHOS = [
  { icone: BadgePercent, texto: "Preço de parceiro, abaixo do balcão" },
  { icone: FileText, texto: "Orçamento em PDF com a sua marca" },
  { icone: Gift, texto: "Crédito a cada pedido pago" },
];

/**
 * A moldura: banner da campanha de um lado, o cartão do outro, tudo sobre o
 * fundo escuro da marca. No celular o banner vira a faixa de cima e a página
 * rola; o cartão segue o tema (branco no claro, escuro no escuro).
 */
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-sidebar text-sidebar-foreground lg:flex-row">
      {/* Meta Pixel sem JavaScript: o PageView da campanha ainda conta. */}
      <noscript>
        <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`} />
      </noscript>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-1" style={{ background: "var(--gradient-cmyk)" }} />
      {/* Os brilhos passam da borda: a caixa deles os corta, para a página não ganhar rolagem a mais
          (overflow-hidden na página inteira desligaria o cartaz fixo). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-bex-magenta/20 blur-3xl" />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-bex-cyan/20 blur-3xl" />
      </div>

      {/*
        O banner inteiro, sempre: no celular é a faixa de cima, na largura da tela;
        no computador é o cartaz da esquerda, fixo enquanto o formulário rola.
        Cortar o banner esconderia a moça ou o texto — por isso ele nunca é recortado.
      */}
      {/* self-start: sem isso o flex estica o cartaz à altura do formulário e o sticky não tem onde grudar */}
      <aside className="relative lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[54%] lg:max-w-3xl lg:flex-col lg:items-center lg:justify-center lg:self-start lg:p-10">
        <img
          src={BANNER_DO_CONVITE}
          alt="Bex Print — suas ideias em grandes resultados. Gráfica, personalizados e impressão 3D."
          width={1478}
          height={1064}
          fetchPriority="high"
          className="h-auto w-full object-contain object-left lg:max-h-full lg:w-auto lg:max-w-full lg:rounded-2xl lg:shadow-2xl lg:ring-1 lg:ring-sidebar-foreground/10"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-sidebar to-transparent lg:hidden" />
        <p className="absolute bottom-4 left-10 hidden text-xs text-sidebar-foreground/80 lg:block">Bex Print · Macapá, Amapá</p>
      </aside>

      <main className="relative flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-10 pt-2 sm:px-8 lg:px-10 lg:py-12">
          <div className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl sm:p-8">{children}</div>
          <p className="mt-6 text-center text-sm text-sidebar-foreground/80">
            Já é parceiro?{" "}
            <Link
              to="/login"
              search={{ como: "parceiro" }}
              className="rounded-sm font-medium text-sidebar-accent-foreground underline decoration-sidebar-border underline-offset-4 hover:decoration-[var(--sidebar-marca)]"
            >
              Entrar no meu painel
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/** Link dentro do cartão: segue o tema do cartão, não o do fundo escuro. */
const linkNoCartao =
  "inline-block rounded-sm pt-2 font-medium text-card-foreground underline decoration-border underline-offset-4 hover:decoration-bex-cyan";

const botaoCiano =
  "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-bex-cyan text-base font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

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

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  // "gmai.com"? Avisa uma vez antes de criar a conta; o e-mail é o login e não se recupera errado.
  const [sugestaoEmail, setSugestaoEmail] = useState<string | null>(null);
  const [emailConferido, setEmailConferido] = useState(false);
  const [pronto, setPronto] = useState<{ whatsapp: boolean } | null>(null);
  // UTM de onde a pessoa veio (anúncio, story, link direto): vai junto no cadastro.
  const [origem, setOrigem] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setOrigem(lerOrigemDaUrl(window.location.search));
  }, []);
  /** O código da casa (BEXPRINT) não é indicação de ninguém: o título muda. */
  const daCasa = codigo.trim().toUpperCase() === "BEXPRINT";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const falta = validarCadastroRapido({ nome, telefone, email });
    if (falta) return toast.error(falta.mensagem);
    const sugestao = sugerirEmail(email);
    if (sugestao && !emailConferido) {
      setSugestaoEmail(sugestao);
      setEmailConferido(true);
      document.getElementById("convite-email")?.focus();
      return;
    }

    setEnviando(true);
    try {
      // A senha provisória nasce aqui e vai pelo WhatsApp; no primeiro acesso a
      // pessoa cria a dela. `cadastro_pendente` é a marca que abre essa tela.
      const senha = gerarSenhaProvisoria();
      const emailLimpo = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: emailLimpo,
        password: senha,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { nome: nome.trim(), telefone: telefone.trim(), [CHAVE_CADASTRO_PENDENTE]: true },
        },
      });
      if (error) throw new Error(erroDoCadastro(error.message));
      // E-mail já cadastrado: o Supabase não erra, devolve um usuário sem identidades.
      if (data.user && (data.user.identities ?? []).length === 0) {
        throw new Error("Este e-mail já tem cadastro. Entre pela aba \"Sou parceiro ou terceirizado\" na tela de login (ou use \"esqueci a senha\").");
      }
      const usuarioId = data.user?.id;
      if (!usuarioId) throw new Error("O cadastro não retornou a conta criada.");

      const { data: resultado, error: erroRpc } = await (supabase.rpc as any)("parceiro_cadastrar_rapido", {
        p_codigo: codigo,
        p_usuario_id: usuarioId,
        p_nome: nome.trim(),
        p_telefone: telefone.trim(),
        p_email: emailLimpo,
        p_senha: senha,
        p_origem: origem,
      });
      // A conta já existe neste ponto. Se o vínculo falhar, a pessoa precisa
      // saber que a conta vale — e a gráfica precisa saber que houve uma
      // conta órfã, em vez de um cadastro que "sumiu".
      if (erroRpc) {
        throw new Error(
          `Sua conta foi criada, mas o vínculo com o convite falhou: ${erroRpc.message}. ` +
            `Fale com a Bex Print informando o e-mail que você usou.`,
        );
      }

      setPronto({ whatsapp: (resultado as { whatsapp_enfileirado?: boolean } | null)?.whatsapp_enfileirado !== false });
      cadastroParceiroConcluidoMeta();
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  if (convite.isLoading) {
    return (
      <Moldura>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Conferindo o convite...
        </p>
      </Moldura>
    );
  }

  if (!convite.data) {
    return (
      <Moldura>
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">Convite não encontrado</h1>
          <p className="text-sm text-muted-foreground">
            Este link não está mais valendo, ou foi digitado com algum caractere trocado. Peça um
            link novo a quem te indicou.
          </p>
          <Link to="/seja-parceiro" className={linkNoCartao}>
            Conhecer a parceria
          </Link>
        </div>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura>
        <div className="space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-bex-cyan" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Cadastro feito — acesso liberado</h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo, <strong className="text-card-foreground">{nome.trim()}</strong>. Seu painel de
            parceiro já está liberado.
          </p>
          <p className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-left text-sm">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-bex-cyan" aria-hidden="true" />
            <span>
              {pronto.whatsapp
                ? <>Mandamos no seu WhatsApp <strong className="text-card-foreground">{telefone}</strong> o link de entrada, o seu e-mail e uma senha provisória, para você entrar de qualquer aparelho.</>
                : <>Não conseguimos mandar o acesso pelo WhatsApp agora. Entre pelo botão abaixo e, se precisar da senha depois, use "Esqueci a senha" com o e-mail <strong className="text-card-foreground">{email.trim().toLowerCase()}</strong>.</>}
            </span>
          </p>
          {/* Endereço completo de propósito: a página recarrega e lê o papel novo do banco. */}
          <a href="/parceiro" className={botaoCiano}>
            Abrir meu painel agora <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <p className="text-xs text-muted-foreground">
            No primeiro acesso você cria a sua senha e completa o cadastro em um minuto.
          </p>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <header className="mb-6">
        <img src={LOGO_FUNDO_ESCURO} alt="" width={1165} height={532} className="mb-4 hidden h-auto w-24 dark:block" />
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-status-cyan">Convite de parceiro</p>
        <h1 className="mt-1 text-balance text-2xl font-semibold leading-tight tracking-tight">
          {daCasa
            ? "Seja parceiro da Bex Print"
            : `${convite.data.convidado_por} te indicou para o clube de parceiros`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Programa exclusivo para quem trabalha com impressão e comunicação visual.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {GANHOS.map((g) => (
            <li key={g.texto} className="flex items-center gap-2.5">
              <g.icone className="h-4 w-4 shrink-0 text-bex-cyan" aria-hidden="true" />
              {g.texto}
            </li>
          ))}
        </ul>
      </header>

      {/* noValidate: a conferência é nossa, com aviso no canto; o campo marca o que é obrigatório. */}
      <form onSubmit={enviar} noValidate className="space-y-4">
        <CampoDeAcesso
          id="convite-nome"
          className={campoCls}
          rotulo="Seu nome ou o da sua empresa"
          placeholder="Como o seu cliente te conhece"
          autoComplete="organization"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <CampoDeAcesso
          id="convite-whatsapp"
          className={campoCls}
          rotulo="WhatsApp"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="(96) 99999-9999"
          required
          value={telefone}
          onChange={(e) => setTelefone(mascaraWhatsapp(e.target.value))}
        />
        <div>
          <CampoDeAcesso
            id="convite-email"
            className={campoCls}
            rotulo="Seu e-mail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            erro={sugestaoEmail ? `Você quis dizer ${sugestaoEmail}? Se o e-mail estiver certo, é só enviar de novo.` : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setSugestaoEmail(null);
              setEmailConferido(false);
            }}
          />
          {sugestaoEmail && (
            <button
              type="button"
              onClick={() => {
                setEmail(sugestaoEmail);
                setSugestaoEmail(null);
                setEmailConferido(false);
              }}
              className="mt-1 inline-flex min-h-10 items-center rounded-sm text-sm font-semibold text-bex-cyan underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Usar {sugestaoEmail}
            </button>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">É o seu login. A senha provisória chega no WhatsApp.</p>
        </div>

        {/* Botão sólido ciano com letra preta (7:1): no fundo escuro a borda neon some. */}
        <button type="submit" disabled={enviando} aria-busy={enviando} className={botaoCiano}>
          {enviando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Enviando...
            </>
          ) : (
            <>
              Quero ser parceiro <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Ao se cadastrar, você concorda com a nossa{" "}
          <Link to="/privacidade" target="_blank" className="rounded-sm font-medium text-card-foreground underline decoration-border underline-offset-4 hover:decoration-bex-cyan">
            Política de Privacidade
          </Link>
          .
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Sem taxa de adesão e sem compra obrigatória. O painel é liberado na hora.
        </p>
      </form>
    </Moldura>
  );
}
