import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { podeRenovar } from "@/domain/orcamentos/renovacao";
import {
  COLUNAS_DO_ENVIADO,
  ETAPAS_DO_ENVIADO,
  idadeEmDias,
  montarQuadro,
  rotuloDaIdade,
  rotuloDaValidade,
  validadeDoOrcamento,
  type ColunaDoQuadro,
  type EtapaDoEnviado,
  type OrcamentoDoQuadro,
} from "@/domain/orcamentos/quadro";

/** Faixa de cor no topo de cada coluna: o estado se lê sem ler a palavra. */
const FAIXA: Record<ColunaDoQuadro, string> = {
  rascunho: "border-t-[color:var(--muted-foreground)]",
  emitido: "border-t-[color:var(--muted-foreground)]",
  enviado: "border-t-[color:var(--bex-cyan)]",
  em_negociacao: "border-t-[color:var(--bex-cyan)]",
  aceite_verbal: "border-t-primary",
  aprovado: "border-t-[color:var(--bex-lime)]",
  os: "border-t-[color:var(--bex-lime)]",
  rejeitado: "border-t-[color:var(--bex-magenta)]",
  expirado: "border-t-[color:var(--bex-amber)]",
};

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O que o orçamento enviado ainda tem de dizer: até quando vale e em que pé está a conversa. A
 * etapa é um seletor de verdade (leitor de tela e teclado), não arrastar. Só quem pode editar
 * orçamento vê o seletor.
 */
function EtapaDoEnviado({
  o,
  coluna,
  agora,
  podeMover,
  aoMoverEtapa,
}: {
  o: OrcamentoDoQuadro;
  coluna: ColunaDoQuadro;
  agora: Date;
  podeMover: boolean;
  aoMoverEtapa?: (o: OrcamentoDoQuadro, etapa: EtapaDoEnviado) => void;
}) {
  const validade = validadeDoOrcamento(o, agora);
  const rotuloValidade = rotuloDaValidade(validade);
  return (
    <>
      {rotuloValidade && (
        <p
          data-validade={validade?.urgente ? "urgente" : "ok"}
          className={cn("mt-2 text-sm", validade?.urgente ? "font-semibold text-foreground" : "text-muted-foreground")}
        >
          Validade: {rotuloValidade}
        </p>
      )}
      {podeMover && aoMoverEtapa && (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`etapa-${o.id}`}>
            Etapa do orçamento {o.numero}
          </label>
          <select
            id={`etapa-${o.id}`}
            value={coluna as EtapaDoEnviado}
            onChange={(e) => aoMoverEtapa(o, e.target.value as EtapaDoEnviado)}
            className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ETAPAS_DO_ENVIADO.map((e) => (
              <option key={e.id} value={e.id}>
                {e.rotulo}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

/**
 * Quadro de orçamentos: uma coluna por estado, com o total em dinheiro e a
 * quantidade no alto (como o Painel de Negociação do Holdprint). Sem arrastar:
 * aprovar e converter têm travas no banco e continuam por botão.
 */
export function QuadroDeOrcamentos({
  orcamentos,
  mostrarValores,
  podeConverter,
  podeMover = false,
  agora = new Date(),
  aoAbrir,
  aoConverter,
  aoMoverEtapa,
  aoRenovar,
}: {
  orcamentos: OrcamentoDoQuadro[];
  mostrarValores: boolean;
  podeConverter: boolean;
  /** Pode mudar a etapa de um orçamento enviado (a mesma permissão que o banco cobra para editar). */
  podeMover?: boolean;
  agora?: Date;
  aoAbrir: (id: string) => void;
  aoConverter: (o: OrcamentoDoQuadro) => void;
  aoMoverEtapa?: (o: OrcamentoDoQuadro, etapa: EtapaDoEnviado) => void;
  /** Expirado ou enviado vencido: volta a Enviado com validade nova e abre para reenviar. */
  aoRenovar?: (o: OrcamentoDoQuadro) => void;
}) {
  const colunas = montarQuadro(orcamentos, { mostrarValores });
  return (
    <div className="flex gap-4 overflow-x-auto p-4" role="list" aria-label="Quadro de orçamentos">
      {colunas.map((c) => (
        <section
          key={c.id}
          role="listitem"
          aria-label={`${c.titulo}: ${c.quantidade}`}
          className={cn("flex w-72 shrink-0 flex-col gap-3", !c.aberta && "opacity-95")}
        >
          <header className={cn("rounded-lg border border-border border-t-4 bg-card px-4 py-3 shadow-sm", FAIXA[c.id])}>
            <h3 className="text-base font-bold text-foreground">{c.titulo}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {c.total !== null && <span className="font-semibold text-foreground">{moeda(c.total)} · </span>}
              {c.quantidade === 1 ? "1 orçamento" : `${c.quantidade} orçamentos`}
            </p>
          </header>
          <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto pr-1">
            {c.itens.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {c.dica}
              </p>
            )}
            {c.itens.map((o) => {
              const idade = rotuloDaIdade(idadeEmDias(o.created_at, agora));
              const cliente = o.cliente_nome ?? o.contato_nome ?? "Sem cliente";
              return (
                <div key={o.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <button
                    type="button"
                    onClick={() => aoAbrir(o.id)}
                    className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-mono text-sm text-link">#{o.numero}</span>
                    <span className="mt-0.5 line-clamp-2 block text-base font-semibold leading-snug text-foreground">
                      {o.titulo || "Sem título"}
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {cliente}
                      {!o.cliente_nome && o.contato_nome ? " · sem cadastro" : ""}
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-2 text-sm">
                      {mostrarValores ? (
                        <span className="font-bold text-foreground">{moeda(Number(o.valor_total ?? 0) || 0)}</span>
                      ) : (
                        <span />
                      )}
                      {idade && <span className="text-muted-foreground">{idade}</span>}
                    </span>
                  </button>
                  {COLUNAS_DO_ENVIADO.includes(c.id) && (
                    <EtapaDoEnviado o={o} coluna={c.id} agora={agora} podeMover={podeMover} aoMoverEtapa={aoMoverEtapa} />
                  )}
                  {podeMover && aoRenovar && podeRenovar(o, agora) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 h-10 w-full text-sm"
                      onClick={() => aoRenovar(o)}
                      data-testid="renovar-orcamento"
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Renovar e reenviar
                    </Button>
                  )}
                  {c.id === "aprovado" && podeConverter && (
                    <Button size="sm" className="mt-3 h-10 w-full text-sm" onClick={() => aoConverter(o)}>
                      Converter em OS <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
