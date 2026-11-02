import { useState } from "react";
import { Bookmark, Copy, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RodapeDeTotais } from "@/components/financeiro/lista-financeira";
import type { TotaisDaLista } from "@/domain/financeiro/lista-de-contas";
import type { EstadoDoCabecalho } from "@/domain/financeiro/selecao-de-contas";
import { LIMITE_DE_VISOES, TAMANHO_DO_NOME, type VisaoSalva } from "@/domain/financeiro/visoes-salvas";

/**
 * Peças da seleção e das visões nas listas financeiras (02/11/2026): a caixa de marcação de cada
 * linha, o cabeçalho que marca todas as que aparecem, a barra com o total dos selecionados e as
 * visões salvas. A conta e o texto estão em `domain/financeiro/selecao-de-contas.ts` e
 * `visoes-salvas.ts`; aqui só o desenho. Nenhuma peça mexe em dinheiro.
 */

/** A caixa tem 24 px e o alvo de toque 44 px: é o que o dono, que enxerga mal, precisa para acertar. */
export function CaixaDeSelecao({
  marcada,
  onChange,
  rotulo,
  className,
}: {
  marcada: boolean | "indeterminate";
  onChange: () => void;
  /** O que o leitor de tela anuncia: "Selecionar Aluguel da plotter". */
  rotulo: string;
  className?: string;
}) {
  return (
    <span className={cn("grid h-11 w-11 shrink-0 place-items-center", className)}>
      <Checkbox checked={marcada} onCheckedChange={() => onChange()} aria-label={rotulo} className="h-6 w-6" />
    </span>
  );
}

/** Linha acima da lista: marca (ou desmarca) todas as contas que aparecem com o filtro de agora. */
export function CabecalhoDaSelecao({
  estado,
  aparecem,
  onAlternar,
}: {
  estado: EstadoDoCabecalho;
  /** Quantas contas aparecem agora. */
  aparecem: number;
  onAlternar: () => void;
}) {
  if (aparecem === 0) return null;
  return (
    <div className="flex items-center gap-1 border-b border-border px-2" data-testid="cabecalho-da-selecao">
      <CaixaDeSelecao
        marcada={estado === "todas" ? true : estado === "algumas" ? "indeterminate" : false}
        onChange={onAlternar}
        rotulo={`Selecionar as ${aparecem} que aparecem`}
      />
      <span className="text-sm text-muted-foreground">
        {estado === "todas" ? `As ${aparecem} que aparecem estão marcadas` : `Marcar as ${aparecem} que aparecem`}
      </span>
    </div>
  );
}

/** Aparece quando há conta marcada: quantas, o dinheiro por situação e o que dá para fazer com elas. */
export function BarraDaSelecao({
  totais,
  tela,
  rotuloPagas,
  foraDoFiltro,
  onCopiar,
  onBaixarCsv,
  onLimpar,
}: {
  totais: TotaisDaLista;
  tela: { singular: string; plural: string };
  rotuloPagas: string;
  /** Marcadas que o filtro de agora esconde. */
  foraDoFiltro: number;
  onCopiar: () => void;
  onBaixarCsv: () => void;
  onLimpar: () => void;
}) {
  const n = totais.quantidade;
  return (
    <section aria-label="Contas selecionadas" className="border-b border-border bg-muted/40" data-testid="barra-da-selecao">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <p role="status" className="mr-auto text-sm font-semibold">
          {n} {n === 1 ? tela.singular : tela.plural} {n === 1 ? "selecionada" : "selecionadas"}
          {foraDoFiltro > 0 && (
            <span className="font-normal text-muted-foreground"> · {foraDoFiltro} fora do filtro de agora</span>
          )}
        </p>
        <Button type="button" size="sm" variant="outline" className="h-10" onClick={onCopiar}>
          <Copy className="mr-1 h-4 w-4" aria-hidden="true" /> Copiar resumo
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10" onClick={onBaixarCsv}>
          <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Baixar CSV
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-10" onClick={onLimpar}>
          <X className="mr-1 h-4 w-4" aria-hidden="true" /> Limpar seleção
        </Button>
      </div>
      <RodapeDeTotais totais={totais} rotuloPagas={rotuloPagas} rotulo="Totais da seleção" />
    </section>
  );
}

/** As visões salvas de quem usa a tela: um toque aplica, o x remove, e dá para guardar a de agora. */
export function BarraDeVisoes<F>({
  visoes,
  ativaId,
  podeGuardar,
  onAplicar,
  onGuardar,
  onRemover,
}: {
  visoes: ReadonlyArray<VisaoSalva<F>>;
  /** A visão cujo filtro é o de agora, se houver. */
  ativaId: string | null;
  /** Falso quando o filtro de agora é o padrão (não há o que guardar). */
  podeGuardar: boolean;
  onAplicar: (v: VisaoSalva<F>) => void;
  /** Devolve a frase do erro, ou nulo quando guardou. */
  onGuardar: (nome: string) => string | null;
  onRemover: (v: VisaoSalva<F>) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  if (visoes.length === 0 && !podeGuardar && !guardando) return null;

  return (
    <div role="group" aria-label="Visões salvas" className="flex flex-wrap items-center gap-2" data-testid="barra-de-visoes">
      <span className="text-sm font-medium text-muted-foreground">Visões</span>
      {visoes.map((v) => {
        const ativa = v.id === ativaId;
        return (
          <span
            key={v.id}
            className={cn(
              "inline-flex items-center rounded-full border text-sm font-semibold",
              ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
            )}
          >
            <button
              type="button"
              aria-pressed={ativa}
              onClick={() => onAplicar(v)}
              className="h-10 rounded-l-full pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {v.nome}
            </button>
            <button
              type="button"
              aria-label={`Remover a visão ${v.nome}`}
              onClick={() => onRemover(v)}
              className="grid h-10 w-10 place-items-center rounded-r-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {guardando ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const e1 = onGuardar(nome);
            setErro(e1);
            if (!e1) {
              setNome("");
              setGuardando(false);
            }
          }}
        >
          <Input
            aria-label="Nome da visão"
            placeholder="Nome, como Vencidas do mês"
            value={nome}
            maxLength={TAMANHO_DO_NOME}
            onChange={(e) => setNome(e.target.value)}
            className="h-10 w-56 text-base md:text-sm"
            autoFocus
          />
          <Button type="submit" size="sm" className="h-10">
            Guardar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-10"
            onClick={() => {
              setGuardando(false);
              setErro(null);
            }}
          >
            Agora não
          </Button>
        </form>
      ) : (
        podeGuardar &&
        visoes.length < LIMITE_DE_VISOES && (
          <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => setGuardando(true)}>
            <Bookmark className="mr-1 h-4 w-4" aria-hidden="true" /> Guardar esta visão
          </Button>
        )
      )}
      {erro && (
        <p role="alert" className="w-full text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
