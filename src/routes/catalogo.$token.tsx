import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Clock, Loader2, MessageCircle, Phone, RefreshCw, Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BexLogo } from "@/components/bex/BexLogo";
import { CartaoDaVitrine } from "@/components/catalogo/cartao-da-vitrine";
import { ErroDaVitrine, abrirVitrine } from "@/lib/catalogo-publico";
import {
  MENSAGEM_VITRINE_INVALIDA,
  linkDoWhatsapp,
  mensagemDoPedido,
  tokenDoCatalogoBemFormado,
  whatsappDaEmpresa,
} from "@/domain/catalogo/link-do-catalogo";
import { ROTULO_DA_MODALIDADE, ehModalidade } from "@/domain/catalogo/modalidades";
import { secoesDaVitrine, type Vitrine } from "@/domain/catalogo/vitrine";
import { dataCurta } from "@/domain/portal/link-do-portal";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

/**
 * A vitrine do cliente — sem login, aberta no celular a partir do WhatsApp.
 *
 * DECISÃO DO DONO (05/10/2026): o cliente vê foto, nome, especificação,
 * código BX e o preço de venda já pronto; não vê o nome nem o código do
 * fornecedor; item sem foto não aparece. Preço que a regra não cobre aparece
 * "sob consulta" — nunca R$ 0,00.
 *
 * O link é gerado pela equipe em /catalogos/$id (aba Links), o banco guarda só
 * o hash do token, com validade e cancelamento, e tudo passa pela rota
 * /api/catalogo/vitrine. Link que não abre diz isso e mais nada.
 */
export const Route = createFileRoute("/catalogo/$token")({
  head: () => ({
    meta: [
      { title: "Catálogo — Bex Print" },
      // Link pessoal: não entra em buscador nem em prévia de rede social.
      { name: "robots", content: "noindex, nofollow" },
      // O token está no endereço desta página: sem isto, cada foto carregada
      // levaria o endereço inteiro no cabeçalho Referer.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: VitrinePage,
});

type Escolha = { codigo: string; opcao: string | null };

function VitrinePage() {
  const { token } = Route.useParams();
  const bemFormado = tokenDoCatalogoBemFormado(token);

  const vitrine = useQuery({
    queryKey: ["catalogo-vitrine", token],
    enabled: bemFormado,
    queryFn: () => abrirVitrine(token),
    retry: (falhas, erro) =>
      falhas < 2 &&
      erro instanceof ErroDaVitrine &&
      (erro.motivo === "fora_do_ar" || erro.motivo === "sem_conexao"),
  });

  if (
    !bemFormado ||
    (vitrine.isError && vitrine.error instanceof ErroDaVitrine && vitrine.error.motivo === "link_invalido")
  ) {
    return (
      <Moldura>
        <Alert variant="destructive" className="mx-auto max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Catálogo indisponível</AlertTitle>
          <AlertDescription>{MENSAGEM_VITRINE_INVALIDA}</AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  if (vitrine.isPending) {
    return (
      <Moldura>
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o catálogo…
        </div>
      </Moldura>
    );
  }

  if (vitrine.isError) {
    // Rede ou banco fora NÃO é link vencido: o cliente pediria outro link por
    // um problema que não é dele.
    return (
      <Moldura>
        <Alert className="mx-auto max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível abrir agora</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{mensagemErro(vitrine.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void vitrine.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  return <VitrineAberta v={vitrine.data} />;
}

function VitrineAberta({ v }: { v: Vitrine }) {
  const [busca, setBusca] = useState("");
  const [secao, setSecao] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Escolha[]>([]);
  const secoes = useMemo(() => secoesDaVitrine(v.itens), [v.itens]);
  const whatsapp = whatsappDaEmpresa(v.empresa.telefones);
  const nomeDaEmpresa = v.empresa.nome ?? "Bex Print";

  const visiveis = useMemo(() => {
    const termos = busca
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return v.itens.filter((i) => {
      if (secao && i.secao !== secao) return false;
      if (termos.length === 0) return true;
      const alvo = `${i.nome} ${i.codigo} ${i.especificacao ?? ""}`
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
      return termos.every((t) => alvo.includes(t));
    });
  }, [v.itens, busca, secao]);

  function alternar(codigo: string, opcao: string | null) {
    setEscolhas((atual) =>
      atual.some((e) => e.codigo === codigo && e.opcao === opcao)
        ? atual.filter((e) => !(e.codigo === codigo && e.opcao === opcao))
        : [...atual, { codigo, opcao }],
    );
  }

  const linkDoPedido =
    whatsapp && escolhas.length > 0
      ? linkDoWhatsapp(
          whatsapp,
          mensagemDoPedido(
            v.titulo,
            escolhas.map((e) => ({
              codigo: e.codigo,
              nome: v.itens.find((i) => i.codigo === e.codigo)?.nome ?? e.codigo,
              opcao: e.opcao && ehModalidade(e.opcao) ? ROTULO_DA_MODALIDADE[e.opcao] : null,
            })),
          ),
        )
      : null;

  return (
    <Moldura empresa={nomeDaEmpresa} rodape={escolhas.length > 0}>
      <header className="mb-5 space-y-2">
        <div className="flex items-center gap-3">
          <BexLogo size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{nomeDaEmpresa}</p>
            {v.empresa.slogan && <p className="truncate text-xs text-muted-foreground">{v.empresa.slogan}</p>}
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{v.titulo}</h1>
        <p className="text-sm text-muted-foreground">
          Toque nas opções que interessam e peça o orçamento pelo WhatsApp com os códigos BX já escritos.
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> Preços válidos até {dataCurta(v.vence_em)}, sujeitos à confirmação no
          orçamento.
        </p>
      </header>

      {v.itens.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Este catálogo está sem itens agora</AlertTitle>
          <AlertDescription>
            Os itens deste link saíram do catálogo. Fale com a {nomeDaEmpresa} para receber um link novo.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou código BX"
                className="h-11 pl-9"
                aria-label="Buscar no catálogo"
              />
            </div>
            {secoes.length > 1 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Seções">
                <Chip ativo={secao === null} onClick={() => setSecao(null)}>
                  Tudo ({v.itens.length})
                </Chip>
                {secoes.map((s) => (
                  <Chip key={s} ativo={secao === s} onClick={() => setSecao(secao === s ? null : s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {visiveis.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nada encontrado com essa busca. Tente outra palavra ou o código BX.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visiveis.map((item) => (
                <CartaoDaVitrine
                  key={item.codigo}
                  item={item}
                  escolhidas={escolhas.filter((e) => e.codigo === item.codigo).map((e) => e.opcao)}
                  onAlternar={(opcao) => alternar(item.codigo, opcao)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <footer className="mt-10 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{nomeDaEmpresa}</p>
        {(v.empresa.cidade || v.empresa.estado) && (
          <p>{[v.empresa.cidade, v.empresa.estado].filter(Boolean).join(" — ")}</p>
        )}
        {v.empresa.telefones && (
          <p className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> {v.empresa.telefones}
          </p>
        )}
      </footer>

      {escolhas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">
                {escolhas.length === 1 ? "1 opção escolhida" : `${escolhas.length} opções escolhidas`}
              </span>
              <button
                type="button"
                className="ml-2 text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => setEscolhas([])}
              >
                limpar
              </button>
            </p>
            {linkDoPedido ? (
              <Button asChild className="h-11">
                <a href={linkDoPedido} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-1 h-4 w-4" /> Pedir orçamento
                </a>
              </Button>
            ) : (
              <p className="text-right text-xs text-muted-foreground">
                Ligue para {v.empresa.telefones ?? nomeDaEmpresa} e diga os códigos BX.
              </p>
            )}
          </div>
        </div>
      )}
    </Moldura>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium",
        ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Moldura({
  children,
  empresa,
  rodape = false,
}: {
  children: ReactNode;
  empresa?: string;
  rodape?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
      <div className={cn("mx-auto max-w-5xl px-4 py-6 sm:py-8", rodape && "pb-28")}>
        {!empresa && (
          <div className="mb-6 flex justify-center">
            <BexLogo size="sm" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
