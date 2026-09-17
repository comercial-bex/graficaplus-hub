/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { simularNiveis } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import { useNiveis, type Nivel } from "./dados";

/**
 * A régua de níveis, com o efeito de cada desconto nos produtos reais.
 *
 * Desconto de revenda é decisão de margem, não de gosto: a simulação responde,
 * antes de salvar, quanto sobra para a gráfica e em quais produtos o piso de
 * margem trava o desconto sozinho. Os produtos de campanha (preço por faixa)
 * não têm custo cadastrado, e por isso têm um desconto separado, que nasce
 * pequeno — sem custo, ninguém sabe se ainda dá lucro.
 */
export function NiveisTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data: niveis = [], isLoading } = useNiveis();
  const [rascunho, setRascunho] = useState<Nivel[]>([]);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => setRascunho(niveis), [niveis]);

  const descontos = useMemo(
    () => rascunho.map((n) => ({ nome: n.nome, desconto_pct: Number(n.desconto_pct) || 0 })),
    [rascunho],
  );
  // espera a digitação parar antes de simular de novo
  const [paraSimular, setParaSimular] = useState(descontos);
  useEffect(() => {
    const t = setTimeout(() => setParaSimular(descontos), 400);
    return () => clearTimeout(t);
  }, [descontos]);

  const { data: simulacao = [], error: erroSimulacao } = useQuery({
    queryKey: ["parceiros-simulacao", paraSimular],
    queryFn: () => simularNiveis(paraSimular),
    enabled: paraSimular.length > 0,
    staleTime: 60_000,
  });

  const mudar = (id: string, parcial: Partial<Nivel>) =>
    setRascunho((lista) => lista.map((n) => (n.id === id ? { ...n, ...parcial } : n)));

  async function salvar(n: Nivel) {
    setSalvando(n.id);
    const { data, error } = await (supabase as any)
      .from("parceiro_niveis")
      .update({
        compra_minima_90d: Number(n.compra_minima_90d) || 0,
        desconto_pct: Number(n.desconto_pct) || 0,
        desconto_faixa_pct: Number(n.desconto_faixa_pct) || 0,
        cashback_pct: Number(n.cashback_pct) || 0,
        cor: n.cor,
        beneficios: n.beneficios.map((b) => b.trim()).filter(Boolean),
      })
      .eq("id", n.id)
      .select("id");
    setSalvando(null);
    if (error || !data?.length) return toast.error(mensagemErro(error, "Seu perfil não pode alterar os níveis."));
    toast.success(`Nível ${n.nome} salvo — vale a partir do próximo acesso de cada parceiro`);
    qc.invalidateQueries({ queryKey: ["parceiros-niveis"] });
    qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const semCusto = simulacao[0]?.produtos_sem_custo ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex max-w-3xl gap-2 rounded-lg border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
        <p>
          Mexer aqui muda o preço de todos os parceiros no próximo acesso deles. Onde o produto tem custo cadastrado, o
          preço nunca desce abaixo do piso de margem mínima — a simulação abaixo mostra onde isso acontece.
        </p>
      </div>

      {/* Simulação: o mesmo desconto, medido nos produtos que a gráfica vende */}
      {simulacao.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 font-medium">
            <Calculator className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            O que cada desconto faz nos {simulacao[0].produtos_com_custo} produtos com custo cadastrado
          </p>
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Nível</th>
                <th className="py-2 pr-3 text-right font-medium">Desconto</th>
                <th className="py-2 pr-3 text-right font-medium">Ganho do parceiro</th>
                <th className="py-2 pr-3 text-right font-medium">Margem média da gráfica</th>
                <th className="py-2 pr-3 text-right font-medium">Menor margem</th>
                <th className="py-2 font-medium">Travados no piso</th>
              </tr>
            </thead>
            <tbody>
              {simulacao.map((s) => (
                <tr key={s.nivel} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium">{s.nivel}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(s.desconto_pct).toLocaleString("pt-BR")}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(s.ganho_medio_parceiro).toLocaleString("pt-BR")}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(s.margem_media_bex).toLocaleString("pt-BR")}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(s.menor_margem_bex).toLocaleString("pt-BR")}%</td>
                  <td className="py-2 text-muted-foreground">
                    {s.travados_no_piso === 0 ? (
                      "nenhum"
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {s.travados_no_piso}
                        <DicaIcone texto={s.quais_travam ?? undefined} rotulo="Produtos travados no piso" />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            “Travado no piso” é o produto em que o desconto do nível derrubaria o preço abaixo da margem mínima: nele o
            parceiro recebe menos desconto, e a margem fica exatamente no mínimo.
            {semCusto > 0 && ` ${semCusto} produto(s) com preço e sem custo cadastrado ficam fora desta conta — neles não há piso.`}
            {" Os produtos de campanha (preço por faixa) usam o desconto de faixa, que é a coluna separada abaixo."}
          </p>
        </section>
      )}
      {erroSimulacao && (
        <p className="text-xs text-muted-foreground">
          A simulação de margem não abriu para o seu perfil ({mensagemErro(erroSimulacao)}).
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rascunho.map((n) => {
          const original = niveis.find((x) => x.id === n.id);
          const sujo = JSON.stringify(original) !== JSON.stringify(n);
          const porMes = Number(n.compra_minima_90d) / 3;
          return (
            <article key={n.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-lg font-semibold">
                  <span className="h-3 w-3 rounded-full" style={{ background: n.cor }} />
                  {n.nome}
                </p>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(n.cor) ? n.cor : "#8b94a7"}
                  disabled={!podeEditar}
                  onChange={(e) => mudar(n.id, { cor: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-input bg-background p-0.5"
                  aria-label={`Cor do nível ${n.nome}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Compras em 90 dias (R$)" ajuda={dicaCampo("/parceiros", "compras em 90 dias")}>
                  <Input type="number" min={0} step="50" disabled={!podeEditar} value={n.compra_minima_90d} onChange={(e) => mudar(n.id, { compra_minima_90d: Number(e.target.value) })} />
                  <p className="text-[11px] text-muted-foreground">
                    {porMes > 0 ? `≈ ${brl(porMes)} por mês` : "nível de entrada"}
                  </p>
                </Campo>
                <Campo rotulo="Desconto na tabela (%)" ajuda={dicaCampo("/parceiros", "desconto na tabela")}>
                  <Input type="number" min={0} max={89} step="0.5" disabled={!podeEditar} value={n.desconto_pct} onChange={(e) => mudar(n.id, { desconto_pct: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Desconto em preço por faixa (%)" ajuda={dicaCampo("/parceiros", "desconto em preço por faixa")}>
                  <Input type="number" min={0} max={89} step="0.5" disabled={!podeEditar} value={n.desconto_faixa_pct} onChange={(e) => mudar(n.id, { desconto_faixa_pct: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Volta em crédito (%)" ajuda={dicaCampo("/parceiros", "volta em crédito")}>
                  <Input type="number" min={0} max={30} step="0.5" disabled={!podeEditar} value={n.cashback_pct} onChange={(e) => mudar(n.id, { cashback_pct: Number(e.target.value) })} />
                </Campo>
              </div>
              <Campo rotulo="Benefícios que o parceiro vê (um por linha)" ajuda={dicaCampo("/parceiros", "beneficios")}>
                <Textarea
                  rows={3}
                  disabled={!podeEditar}
                  value={n.beneficios.join("\n")}
                  onChange={(e) => mudar(n.id, { beneficios: e.target.value.split("\n") })}
                />
              </Campo>
              {podeEditar && (
                <Button size="sm" onClick={() => salvar(n)} disabled={!sujo || salvando === n.id}>
                  <Save className="mr-1 h-4 w-4" />
                  {salvando === n.id ? "Salvando…" : "Salvar nível"}
                </Button>
              )}
            </article>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        O nível sobe e desce sozinho pelo valor comprado nos últimos 90 dias (OS não canceladas). O cashback entra quando
        a OS do parceiro fica paga.
      </p>
    </div>
  );
}

function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs text-muted-foreground">
        {rotulo}
        <DicaIcone texto={ajuda} rotulo={rotulo} />
      </Label>
      {children}
    </div>
  );
}
