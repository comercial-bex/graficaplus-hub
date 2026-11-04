import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { gerarFotoDoProduto, mensagemDaFotoGerada } from "@/lib/api/produtos-foto-ia.functions";
import {
  comTempoLimite,
  filaDoLote,
  LOTE_DE_FOTOS,
  produtosSemFoto,
  resumoDoLote,
  rodarLote,
  TEMPO_LIMITE_DA_CHAMADA_MS,
  type FalhaDoLote,
  type ProdutoDoLote,
} from "@/domain/catalogo/lote-de-fotos";

/**
 * "Gerar fotos que faltam" (01/11/2026): o dono pediu o catálogo com foto em
 * todo produto, como no Holdprint. Em vez de abrir produto por produto, este
 * botão percorre os ativos sem foto, um de cada vez, e para na hora se o saldo
 * de IA acabar ou a pessoa mandar parar. Cada foto já fica guardada no produto
 * pelo servidor; aqui a lista se atualiza a cada foto, e as miniaturas vão
 * aparecendo na tabela.
 *
 * 03/11/2026: o lote era de 8 por clique; o dono quis "clicar e ir gerando"
 * até o fim. O teto agora é só de segurança (60 por clique), para uma aba
 * esquecida aberta não gastar saldo sem fim.
 *
 * Revisões de 03 e 04/11/2026 (a regra de parada mora em `domain/catalogo/lote-de-fotos`):
 *   - serviço não entra; o lote para depois de 3 falhas seguidas e na hora num erro de acesso;
 *   - sair desta tela para o lote depois da foto em curso (o botão Parar mora aqui, então um
 *     lote solto não teria como ser parado), e um segundo lote não começa por cima do primeiro;
 *   - "Parar" responde na hora ("Parando..."); a pausa do limite de chamadas some quando acaba;
 *   - uma chamada que nunca volta cai em 4 minutos em vez de prender a tela;
 *   - quem falhou vai para o fim da fila do lote seguinte, e a lista de falhas (nome e motivo)
 *     fica na tela até a pessoa dispensar: o aviso some em 4 segundos e o lote roda uns 20 minutos
 *     numa aba que a pessoa nem está olhando.
 */
export { LOTE_DE_FOTOS, produtosSemFoto };

type ProdutoDaLista = ProdutoDoLote;

/** Há um lote rodando nesta aba (mesmo que a tela dele tenha sido fechada): não começa outro por cima. */
let loteEmCurso = false;

/** Os que falharam neste navegador: vão para o fim da fila do lote seguinte. */
const jaFalharam = new Set<string>();

/** Estados em que nada deu errado e nada precisa de aviso por produto. */
const SEM_AVISO_POR_PRODUTO = new Set(["ok", "ja_tem_foto", "servico", "em_andamento"]);

export function GerarFotosQueFaltam({ produtos }: { produtos: readonly ProdutoDaLista[] }) {
  const fila = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [andamento, setAndamento] = useState<{ feitas: number; total: number; atual: string } | null>(null);
  const [parando, setParando] = useState(false);
  const [esperando, setEsperando] = useState<number | null>(null);
  const [falhas, setFalhas] = useState<FalhaDoLote[]>([]);
  const parar = useRef<false | "pediu" | "saiu">(false);

  // Sair da tela para o lote depois da foto em curso: o botão Parar mora aqui.
  useEffect(
    () => () => {
      parar.current = "saiu";
    },
    [],
  );

  const semFoto = produtosSemFoto(produtos);
  if (semFoto.length === 0 && !andamento && falhas.length === 0) return null;
  const lote = filaDoLote(semFoto, jaFalharam).slice(0, LOTE_DE_FOTOS);

  async function rodar() {
    setConfirmando(false);
    if (loteEmCurso) {
      toast.info("O lote anterior ainda está terminando a foto em curso. Espere alguns segundos e confirme de novo.");
      return;
    }
    loteEmCurso = true;
    parar.current = false;
    setParando(false);
    setEsperando(null);
    setFalhas([]);
    setAndamento({ feitas: 0, total: lote.length, atual: lote[0]?.nome ?? "" });
    try {
      const saida = await rodarLote({
        produtos: lote,
        gerar: (produtoId) =>
          comTempoLimite(
            gerarFotoDoProduto({ data: { produtoId } }),
            TEMPO_LIMITE_DA_CHAMADA_MS,
            "a chamada à IA demorou mais de 4 minutos",
          ),
        devePararAgora: () => parar.current,
        aoComecar: (feitas, p) => {
          setEsperando(null);
          setAndamento({ feitas, total: lote.length, atual: p.nome });
        },
        aoResultado: (p, r) => {
          if ("erro" in r) {
            toast.error(`${p.nome}: ${mensagemErro(r.erro, "não deu para gerar a foto")}`);
          } else if (r.resultado.estado === "ok") {
            // A miniatura aparece na tabela já nesta foto, sem esperar o lote acabar.
            void fila.invalidateQueries({ queryKey: ["produtos"] });
          } else if (!SEM_AVISO_POR_PRODUTO.has(String(r.resultado.estado))) {
            toast.error(`${p.nome}: ${mensagemDaFotoGerada(r.resultado as Parameters<typeof mensagemDaFotoGerada>[0])}`);
          }
        },
        aoEsperarLimite: (segundos) => setEsperando(segundos),
        aoRetomar: () => setEsperando(null),
        traduzirErro: (e) => mensagemErro(e, "não deu para gerar a foto"),
      });
      for (const f of saida.falhados) jaFalharam.add(f.id);
      setFalhas(saida.falhados);
      await fila.invalidateQueries({ queryKey: ["produtos"] });
      const fim = resumoDoLote(saida, semFoto.length);
      if (fim.nivel === "sucesso") toast.success(fim.texto);
      else if (fim.nivel === "info") toast.info(fim.texto);
      else toast.warning(fim.texto);
    } finally {
      loteEmCurso = false;
      setAndamento(null);
      setParando(false);
      setEsperando(null);
    }
  }

  const listaDeFalhas = falhas.length > 0 && (
    <div className="mt-2 max-w-3xl rounded border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 px-3 py-2 text-sm" data-testid="falhas-do-lote">
      <p className="font-medium">
        {falhas.length === 1 ? "1 produto não ganhou foto no último lote:" : `${falhas.length} produtos não ganharam foto no último lote:`}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {falhas.map((f) => (
          <li key={f.id}>
            <strong>{f.nome}</strong>: {f.motivo}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-muted-foreground">Eles vão para o fim da fila no próximo lote. Dá para enviar a foto à mão pela pasta do produto.</p>
      <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setFalhas([])}>
        Dispensar
      </Button>
    </div>
  );

  if (andamento) {
    return (
      <>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border bg-muted/30 px-3 py-2 text-sm" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>
            {parando
              ? "Parando: terminando a foto em curso..."
              : esperando !== null
                ? `A IA pediu uma pausa (limite de chamadas): tentando de novo em até ${esperando} s. ${andamento.atual}`
                : `Gerando foto ${Math.min(andamento.feitas + 1, andamento.total)} de ${andamento.total}: ${andamento.atual}`}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={parando}
            onClick={() => {
              parar.current = "pediu";
              setParando(true);
            }}
          >
            <Square className="mr-1 h-3.5 w-3.5" /> {parando ? "Parando..." : "Parar depois desta"}
          </Button>
        </div>
        {listaDeFalhas}
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {semFoto.length === 0 ? null : confirmando ? (
          <>
            <span>
              Vai gerar {lote.length} {lote.length === 1 ? "foto" : "fotos"} agora pela IA do Lovable
              {semFoto.length > lote.length ? ` (${semFoto.length} sem foto; as primeiras ${lote.length} agora)` : ""}. Cada uma gasta um pouco do
              saldo de IA do projeto e leva alguns segundos: deixe esta aba aberta, nesta tela (se você sair dela, o lote para depois da foto em
              curso). Dá para parar quando quiser. Serviços não entram.
            </span>
            <Button type="button" size="sm" onClick={() => void rodar()} data-testid="confirmar-lote-de-fotos">
              Confirmar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
              Agora não
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(true)} data-testid="gerar-fotos-que-faltam">
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Gerar fotos que faltam ({semFoto.length})
          </Button>
        )}
      </div>
      {listaDeFalhas}
    </>
  );
}
