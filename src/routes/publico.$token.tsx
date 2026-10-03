import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AlertCircle, Clock, Loader2, Lock, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArteParaAprovarCartao } from "@/components/portal/arte-para-aprovar";
import {
  ContatoDaEmpresa,
  EnvioDeArquivo,
  MensagemParaEquipe,
  OQueVoceMandou,
  OrcamentosParaResponder,
} from "@/components/portal/envio-do-cliente";
import { type ObterUrl } from "@/components/portal/abrir-arquivo";
import { ListaDePedidos } from "@/components/portal/pedidos-do-cliente";
import {
  ErroDoPortal,
  abrirPainel,
  decidirArte,
  enviarArquivo,
  enviarMensagem,
  urlDoArquivo,
} from "@/lib/public-access";
import { MENSAGEM_LINK_INVALIDO, dataCurta, tokenBemFormado } from "@/domain/portal/link-do-portal";
import { resumoDoPortal } from "@/domain/portal/painel-do-cliente";
import { mensagemErro } from "@/lib/erros";

/**
 * Portal do cliente por link — sem login, aberto no celular a partir do
 * WhatsApp.
 *
 * Era DEMONSTRAÇÃO: qualquer endereço mostrava o mesmo cliente e o mesmo
 * orçamento fictícios, e os botões Aprovar orçamento, Enviar arquivo,
 * Aprovar/Reprovar arte e Enviar comprovante respondiam "Recebemos sua
 * solicitação com segurança. A equipe foi notificada." sem gravar nada nem
 * avisar ninguém.
 *
 * Agora o link é gerado pela equipe na ficha do cliente (aba Portal), o banco
 * guarda só o hash do token, com validade e cancelamento, e tudo passa pelas
 * rotas /api/portal/*. Sem link válido a página diz isso e mais nada. Cada
 * "recebido" que aparece aqui vem com o protocolo da gravação feita no banco.
 */
export const Route = createFileRoute("/publico/$token")({
  head: () => ({
    meta: [
      { title: "Seu acompanhamento — Bex Print" },
      // Link pessoal: não entra em buscador nem em prévia de rede social.
      { name: "robots", content: "noindex, nofollow" },
      // O token está no endereço desta página. Sem isto, cada imagem e cada
      // arquivo aberto daqui levaria o endereço inteiro no cabeçalho Referer.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PortalPorLinkPage,
});

function PortalPorLinkPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const bemFormado = tokenBemFormado(token);

  const painel = useQuery({
    queryKey: ["portal-link", token],
    enabled: bemFormado,
    queryFn: () => abrirPainel(token),
    retry: (falhas, erro) =>
      falhas < 2 &&
      erro instanceof ErroDoPortal &&
      (erro.motivo === "fora_do_ar" || erro.motivo === "sem_conexao"),
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["portal-link", token] });

  if (
    !bemFormado ||
    (painel.isError &&
      painel.error instanceof ErroDoPortal &&
      painel.error.motivo === "link_invalido")
  ) {
    return (
      <Moldura>
        <Alert variant="destructive" className="mx-auto max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Link indisponível</AlertTitle>
          <AlertDescription>{MENSAGEM_LINK_INVALIDO}</AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  if (painel.isPending) {
    return (
      <Moldura>
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o seu acompanhamento…
        </div>
      </Moldura>
    );
  }

  if (painel.isError) {
    // Falha de rede ou banco fora NÃO é "link inválido": o cliente tentaria
    // pedir outro link por um problema que não é dele.
    return (
      <Moldura>
        <Alert className="mx-auto max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível abrir agora</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{mensagemErro(painel.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void painel.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  const p = painel.data;
  const resumo = resumoDoPortal(p);
  const artes = p.ordens.flatMap((o) =>
    o.artes_para_aprovar.map((a) => ({ arte: a, osNumero: o.numero, osTitulo: o.titulo })),
  );
  const orcamentosAbertos = p.orcamentos;

  const obterUrl: ObterUrl = async (alvo) =>
    (await urlDoArquivo(token, { tipo: alvo.tipo, id: alvo.id, para: alvo.para })).url;

  return (
    <Moldura empresa={p.empresa.nome}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Olá, {p.cliente.nome}</h1>
          <p className="text-muted-foreground">
            Seus pedidos na {p.empresa.nome}: acompanhe, aprove a arte e mande arquivos.
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> Este link é só seu e vale até {dataCurta(p.vence_em)}.
          </p>
        </header>

        {(artes.length > 0 || orcamentosAbertos.length > 0) && (
          <Secao
            titulo={resumo.esperandoVoce > 0 ? "Esperando você" : "Para acompanhar"}
            descricao="Arte para aprovar e orçamento para responder."
          >
            <div className="space-y-3">
              {artes.map(({ arte, osNumero, osTitulo }) => (
                <ArteParaAprovarCartao
                  key={arte.arquivo_id}
                  arte={arte}
                  osNumero={osNumero}
                  osTitulo={osTitulo}
                  obterUrl={obterUrl}
                  onDecidir={async (decisao, comentario) => {
                    await decidirArte(token, { arquivoId: arte.arquivo_id, decisao, comentario });
                    await recarregar();
                  }}
                />
              ))}
              <OrcamentosParaResponder orcamentos={orcamentosAbertos} />
            </div>
          </Secao>
        )}

        <Secao
          titulo="Seus pedidos"
          descricao="Situação, previsão de entrega, valor e arquivos de cada pedido."
        >
          <ListaDePedidos ordens={p.ordens} obterUrl={obterUrl} />
        </Secao>

        <Secao
          titulo="Mandar arquivo ou comprovante"
          descricao="O arquivo vai direto para o pedido; o comprovante, para o financeiro conferir."
        >
          <EnvioDeArquivo
            ordens={p.ordens}
            onEnviar={async (dados) => {
              const r = await enviarArquivo(token, dados);
              await recarregar();
              return r;
            }}
          />
        </Secao>

        <Secao titulo="Falar com a equipe">
          <div className="space-y-4">
            <MensagemParaEquipe
              ordens={p.ordens}
              onEnviar={async (dados) => {
                const r = await enviarMensagem(token, dados);
                await recarregar();
                return r;
              }}
            />
            <ContatoDaEmpresa empresa={p.empresa} />
          </div>
        </Secao>

        <Secao titulo="O que você já mandou">
          <OQueVoceMandou solicitacoes={p.solicitacoes} comprovantes={p.comprovantes} />
        </Secao>
      </div>
    </Moldura>
  );
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{titulo}</CardTitle>
        {descricao && <CardDescription>{descricao}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Moldura({ children, empresa }: { children: ReactNode; empresa?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <span>{empresa ?? "Bex Print"}</span>
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" /> acesso do cliente
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
