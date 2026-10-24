import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dica } from "@/components/bex/Dica";
import { cn } from "@/lib/utils";
import { categoriaLabel } from "@/lib/produtos-catalogo";
import { fichaDoProduto, margemSobreVenda, posicaoNoMercado } from "@/domain/precos/tabela-de-precos";
import { BarraDeComparacao } from "./barra-de-comparacao";
import { marcadoresDaLinha, pisoDaMargem, SeloDaFicha } from "./ficha-do-produto";
import { IconeDoProduto } from "./icone-do-produto";
import { brl, pct, sinal, type Linha } from "./tipos";

export function fichaDaLinha(l: Linha) {
  return fichaDoProduto({
    tipo: l.produto.tipo,
    categoria: l.produto.categoria,
    temReceita: l.receita.length > 0,
    minutos: l.produto.tempo_producao_min,
    temMaquina: !!l.produto.maquina_padrao_id,
    composicao: l.composicao,
  });
}

export function PilulaDeMargem({ margem, minimo, rotulo }: { margem: number | null; minimo: number | null; rotulo: string }) {
  const abaixo = margem != null && minimo != null && margem < minimo;
  const negativa = margem != null && margem < 0;
  return (
    <Dica texto={`${rotulo}: lucro ÷ preço${minimo != null ? `. Mínimo do produto: ${pct(minimo)}.` : "."}`}>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold",
          margem == null && "border-border text-muted-foreground",
          margem != null && !abaixo && "border-success/40 bg-success/10 text-success",
          abaixo && !negativa && "border-warning/50 bg-warning/20 text-foreground",
          negativa && "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        {rotulo ? `${rotulo} ` : ""}{pct(margem)}
      </span>
    </Dica>
  );
}

export function CartaoDoProduto({
  linha,
  selecionado,
  podeSelecionar,
  aoSelecionar,
  aoAbrir,
}: {
  linha: Linha;
  selecionado: boolean;
  podeSelecionar: boolean;
  aoSelecionar: (v: boolean) => void;
  aoAbrir: () => void;
}) {
  const p = linha.produto;
  const minimo = p.margem_minima;
  const mF = margemSobreVenda(linha.venda, linha.custoBase);
  const mP = margemSobreVenda(linha.parceiro?.valor ?? null, linha.custoBase);
  const menor = linha.concorrentes.length ? Math.min(...linha.concorrentes.map((c) => c.preco)) : null;
  const mercado = posicaoNoMercado(linha.venda, linha.concorrentes.filter((c) => c.tipo_preco === "final").map((c) => c.preco));
  const ficha = fichaDaLinha(linha);
  const margemRealRuim = linha.cheio != null && minimo != null && (margemSobreVenda(linha.venda, linha.cheio) ?? 100) < minimo && !(mF != null && mF < minimo);

  return (
    <article
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border bg-card p-3.5 transition-shadow hover:shadow-md",
        selecionado ? "border-primary ring-1 ring-primary" : "border-border",
        !p.ativo && "border-dashed",
      )}
    >
      <div className="flex items-start gap-3">
        <IconeDoProduto imagem={p.imagem_url} categoria={p.categoria} nome={p.nome} />
        <button type="button" onClick={aoAbrir} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{p.nome}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.categoria ? categoriaLabel(p.categoria) : "sem categoria"} · por {p.unidade}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <SeloDaFicha nivel={ficha.nivel} />
            {!p.ativo && <Badge variant="outline" className="h-5 px-1.5 text-[11px]">só comparação</Badge>}
            {linha.promocao && <Badge className="h-5 px-1.5 text-[11px]">Promoção {brl(linha.promocao.preco)}</Badge>}
          </div>
        </button>
        <Checkbox
          checked={selecionado}
          disabled={!selecionado && !podeSelecionar}
          onCheckedChange={(v) => aoSelecionar(v === true)}
          aria-label={`Comparar ${p.nome}`}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Valor titulo="Custo" valor={brl(linha.custoBase)} />
        <Valor titulo="Venda final" valor={linha.venda != null ? brl(linha.venda) : "por faixa"} forte />
        <Valor titulo="Parceiro" valor={brl(linha.parceiro?.valor ?? null)} nota={linha.parceiro?.origem === "nivel" ? "pelo nível" : undefined} />
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        <PilulaDeMargem margem={mF} minimo={minimo} rotulo="Final" />
        <PilulaDeMargem margem={mP} minimo={minimo} rotulo="Parceiro" />
        {margemRealRuim && (
          <Dica texto={`Com o custo cheio (matéria-prima + máquina + mão de obra + indireto = ${brl(linha.cheio)}) a margem da venda final fica abaixo do mínimo.`}>
            <span className="rounded-full border border-warning/50 bg-warning/20 px-2 py-0.5 text-[11px] font-semibold">Abaixo do mínimo no custo cheio</span>
          </Dica>
        )}
      </div>

      <div>
        <BarraDeComparacao marcadores={marcadoresDaLinha(linha, pisoDaMargem(linha.custoBase, minimo))} />
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {menor != null ? (
            <>
              Menor concorrente {brl(menor)}
              {mercado && <> · nós <strong className="text-foreground">{sinal(mercado.contraOMenorPct)}</strong></>}
            </>
          ) : (
            "Sem concorrente anotado"
          )}
        </p>
      </div>

      <button type="button" onClick={aoAbrir} className="self-start text-xs font-medium text-primary underline-offset-2 hover:underline">
        Ver ficha, composição e concorrentes
      </button>
    </article>
  );
}

function Valor({ titulo, valor, nota, forte }: { titulo: string; valor: string; nota?: string; forte?: boolean }) {
  return (
    <div className={cn("rounded-lg px-1 py-1.5", forte ? "bg-primary/10" : "bg-muted/50")}>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</dt>
      <dd className={cn("font-mono text-sm", forte && "font-semibold")}>{valor}</dd>
      {nota && <div className="text-[10px] text-muted-foreground">{nota}</div>}
    </div>
  );
}
