import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Clock,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BexLogo } from "@/components/bex/BexLogo";
import { Loja } from "@/components/catalogo/loja/loja";
import { CarrinhoDrawer } from "@/components/catalogo/loja/carrinho-drawer";
import { useCarrinho } from "@/components/catalogo/loja/use-carrinho";
import { PedirCotacaoDialog } from "@/components/catalogo/pedir-cotacao-dialog";
import { ErroDaVitrine, abrirVitrine } from "@/lib/catalogo-publico";
import {
  MENSAGEM_VITRINE_INVALIDA,
  tokenDoCatalogoBemFormado,
  whatsappDaEmpresa,
} from "@/domain/catalogo/link-do-catalogo";
import { itemDaLojaDaVitrine } from "@/domain/catalogo/loja";
import type { Vitrine } from "@/domain/catalogo/vitrine";
import { dataCurta } from "@/domain/portal/link-do-portal";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

/**
 * A vitrine do cliente — sem login, aberta no celular a partir do WhatsApp.
 * A MESMA loja da equipe (categorias, grade, ficha, carrinho), com o que o
 * cliente faz no fim: "Pedir cotação" registra a lista na gráfica e abre o
 * WhatsApp com a mensagem pronta.
 *
 * DECISÃO DO DONO (05/10/2026): o cliente vê foto, nome, especificação,
 * código BX e o preço de venda já pronto; não vê o nome nem o código do
 * fornecedor; item sem foto não aparece. Preço que a regra não cobre aparece
 * "sob consulta" — nunca R$ 0,00.
 *
 * O link é gerado pela equipe em /catalogos/$id (aba Links), o banco guarda só
 * o hash do token, com validade e cancelamento, e tudo passa pelas rotas
 * /api/catalogo/vitrine e /api/catalogo/cotacao. Link que não abre diz isso e
 * mais nada.
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
    (vitrine.isError &&
      vitrine.error instanceof ErroDaVitrine &&
      vitrine.error.motivo === "link_invalido")
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

  return <VitrineAberta v={vitrine.data} token={token} />;
}

function VitrineAberta({ v, token }: { v: Vitrine; token: string }) {
  const qc = useQueryClient();
  const itens = useMemo(() => v.itens.map((i, n) => itemDaLojaDaVitrine(i, n)), [v.itens]);
  // O carrinho é deste link: outro link, outro carrinho (os itens são outros).
  const { carrinho, adicionar, mudarQuantidade, remover, limpar } = useCarrinho(
    `vitrine-${token.slice(0, 12)}`,
  );
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const whatsapp = whatsappDaEmpresa(v.empresa.telefones);
  const nomeDaEmpresa = v.empresa.nome ?? "Bex Print";
  const pecas = carrinho.reduce((s, l) => s + l.quantidade, 0);

  return (
    <Moldura empresa={nomeDaEmpresa} rodape={carrinho.length > 0}>
      {v.itens.length === 0 ? (
        <>
          <Cabecalho v={v} nomeDaEmpresa={nomeDaEmpresa} />
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Este catálogo está sem itens agora</AlertTitle>
            <AlertDescription>
              Os itens deste link saíram do catálogo. Fale com a {nomeDaEmpresa} para receber um
              link novo.
            </AlertDescription>
          </Alert>
        </>
      ) : (
        <Loja
          itens={itens}
          carrinho={carrinho}
          onAdicionar={adicionar}
          onAbrirCarrinho={() => setCarrinhoAberto(true)}
          acima={<Cabecalho v={v} nomeDaEmpresa={nomeDaEmpresa} />}
        />
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

      {carrinho.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">
                {carrinho.length === 1 ? "1 item" : `${carrinho.length} itens`} ·{" "}
                {pecas.toLocaleString("pt-BR")} peças
              </span>
            </p>
            <Button variant="outline" className="h-11" onClick={() => setCarrinhoAberto(true)}>
              <ShoppingCart className="mr-1 h-4 w-4" /> Carrinho
            </Button>
            <Button className="h-11" onClick={() => setPedindo(true)}>
              <MessageCircle className="mr-1 h-4 w-4" /> Pedir cotação
            </Button>
          </div>
        </div>
      )}

      <CarrinhoDrawer
        aberto={carrinhoAberto}
        onOpenChange={setCarrinhoAberto}
        carrinho={carrinho}
        itens={itens}
        onMudarQuantidade={mudarQuantidade}
        onRemover={remover}
        onLimpar={limpar}
        onAbrirProduto={() => setCarrinhoAberto(false)}
        acao={
          <Button
            type="button"
            className="h-12 w-full text-base"
            onClick={() => {
              setCarrinhoAberto(false);
              setPedindo(true);
            }}
          >
            <MessageCircle className="mr-2 h-5 w-5" /> Pedir cotação
          </Button>
        }
        rodape={
          !whatsapp ? (
            <p className="text-right text-xs text-muted-foreground">
              Ligue para {v.empresa.telefones ?? nomeDaEmpresa}.
            </p>
          ) : undefined
        }
      />

      <PedirCotacaoDialog
        aberto={pedindo}
        token={token}
        titulo={v.titulo}
        whatsapp={whatsapp}
        carrinho={carrinho}
        onOpenChange={setPedindo}
        onRegistrado={limpar}
        onLinkInvalido={() => qc.invalidateQueries({ queryKey: ["catalogo-vitrine", token] })}
      />
    </Moldura>
  );
}

function Cabecalho({ v, nomeDaEmpresa }: { v: Vitrine; nomeDaEmpresa: string }) {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-3">
        <BexLogo size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{nomeDaEmpresa}</p>
          {v.empresa.slogan && (
            <p className="truncate text-xs text-muted-foreground">{v.empresa.slogan}</p>
          )}
        </div>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{v.titulo}</h1>
      <p className="text-sm text-muted-foreground">
        Escolha a quantidade, monte o carrinho e peça a cotação: a lista vai pronta para o WhatsApp,
        com os códigos BX.
      </p>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" /> Preços válidos até {dataCurta(v.vence_em)}, sujeitos à
        confirmação no orçamento.
      </p>
    </header>
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
