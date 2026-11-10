import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import {
  ABAS,
  avisoDeOrcamentos,
  contagemPorAba,
  leadsDaAba,
  montarQuadro,
  valorDoCartao,
  type AbaDoQuadro,
  type LeadDoQuadro,
} from "@/domain/crm/quadro-de-leads";
import { origemAgrupada } from "@/domain/crm/origens";

export type LeadDoCartao = LeadDoQuadro & {
  nome: string;
  campanha: string | null;
  dias_parado: number;
  prazo: string | null;
  atrasado: boolean;
};

const brl = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Quadro somente leitura: a etapa vem da cadeia real (orçamento, OS, entrega), não se arrasta. */
export function QuadroDeLeads({
  leads,
  etapas,
  verValores,
}: {
  leads: LeadDoCartao[];
  etapas: { chave: string; rotulo: string }[];
  verValores: boolean;
}) {
  const [aba, setAba] = useState<AbaDoQuadro>("todos");
  const contagem = useMemo(() => contagemPorAba(leads), [leads]);
  const quadro = useMemo(
    () =>
      montarQuadro(
        leadsDaAba(leads, aba),
        etapas.map((e) => e.chave),
      ),
    [leads, aba, etapas],
  );

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1 overflow-x-auto border-b">
        {ABAS.map((a) => (
          <button
            key={a.chave}
            role="tab"
            type="button"
            aria-selected={aba === a.chave}
            onClick={() => setAba(a.chave)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              aba === a.chave
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {a.rotulo}{" "}
            <span className="font-mono text-xs text-muted-foreground">{contagem[a.chave]}</span>
          </button>
        ))}
        <DicaIcone
          texto={dicaCampo("/funil", "abas_por_canal")}
          rotulo="Abas por canal"
          className="ml-auto self-center"
        />
      </div>

      {verValores && !quadro.vazio && (
        <div className="mb-3 grid overflow-hidden rounded-md border sm:grid-cols-2">
          <div className="border-b bg-card p-3 sm:border-b-0 sm:border-r">
            <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Total da aba{" "}
              <DicaIcone texto={dicaCampo("/funil", "total_da_aba")} rotulo="Total da aba" />
            </div>
            <div className="mt-1 text-xl font-semibold">{brl(quadro.totalDaAba)}</div>
          </div>
          <div className="bg-card p-3">
            <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Em aberto <DicaIcone texto={dicaCampo("/funil", "em_aberto")} rotulo="Em aberto" />
            </div>
            <div className="mt-1 text-xl font-semibold">{brl(quadro.emAberto)}</div>
          </div>
        </div>
      )}

      {quadro.vazio ? (
        <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
          {aba === "instagram" || aba === "facebook"
            ? "Nenhum lead deste canal no período. Instagram e Facebook ainda não entram sozinhos: cadastre em Leads."
            : "Nenhum lead nesta aba no período."}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {quadro.colunas.map((col) => {
            const rotulo = etapas.find((e) => e.chave === col.chave)?.rotulo ?? col.chave;
            return (
              <div
                key={col.chave}
                className="flex w-64 flex-shrink-0 flex-col rounded-md border bg-muted/40"
              >
                <div className="border-b p-2">
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{rotulo}</span>
                    <Badge variant="outline" className="font-mono font-normal">
                      {col.quantidade}
                    </Badge>
                  </div>
                  {verValores && (
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {brl(col.soma)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {col.leads.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">—</div>
                  )}
                  {col.leads.map((l) => {
                    const v = valorDoCartao(l);
                    const aviso = avisoDeOrcamentos(l, v);
                    const fechado = ["entregue", "perdido"].includes(l.estagio);
                    return (
                      <div
                        key={l.lead_id}
                        className="rounded-md border bg-card p-2 text-sm shadow-sm"
                      >
                        <div className="font-medium leading-tight">{l.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {origemAgrupada(l.origem)}
                          {l.campanha ? ` · ${l.campanha}` : ""}
                        </div>
                        <div className="mt-1 flex items-end justify-between gap-2 text-xs">
                          <div className="space-y-0.5">
                            {!fechado && (
                              <div
                                className={
                                  l.dias_parado > 15
                                    ? "font-medium text-destructive"
                                    : "text-muted-foreground"
                                }
                              >
                                parado {l.dias_parado}d
                              </div>
                            )}
                            {l.prazo && (
                              <div
                                className={
                                  l.atrasado
                                    ? "font-medium text-destructive"
                                    : "text-muted-foreground"
                                }
                              >
                                prazo {new Date(`${l.prazo}T12:00:00`).toLocaleDateString("pt-BR")}
                              </div>
                            )}
                          </div>
                          {verValores && (
                            <div className="text-right">
                              <div className="font-mono font-semibold">
                                {v ? brl(v.valor) : "—"}
                              </div>
                              {v && (
                                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {v.fonte === "orcado" ? "orçado" : "potencial"}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
