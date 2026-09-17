/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";
import { useNiveis, type Nivel } from "./dados";

/**
 * A régua de níveis.
 *
 * Os valores que vieram com o módulo são PONTO DE PARTIDA, não decisão comercial:
 * o aviso fica na tela até alguém da gestão revisar. Dois descontos existem
 * porque os produtos de campanha (preço por faixa) não têm custo cadastrado — o
 * sistema não sabe se 25% em cima deles ainda dá lucro, então o desconto deles é
 * separado e nasce pequeno.
 */
export function NiveisTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data: niveis = [], isLoading } = useNiveis();
  const [rascunho, setRascunho] = useState<Nivel[]>([]);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => setRascunho(niveis), [niveis]);

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

  return (
    <div className="space-y-4">
      <div className="flex max-w-3xl gap-2 rounded-lg border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
        <p>
          Revise antes de convidar o primeiro parceiro: os valores iniciais são sugestão. O preço do parceiro nunca
          fica abaixo do piso de margem do produto quando o custo está cadastrado — produto sem custo não tem essa
          proteção, por isso o desconto de faixa é separado.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {rascunho.map((n) => {
          const original = niveis.find((x) => x.id === n.id);
          const sujo = JSON.stringify(original) !== JSON.stringify(n);
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
                <Campo rotulo="Compras em 90 dias (R$)">
                  <Input type="number" min={0} step="50" disabled={!podeEditar} value={n.compra_minima_90d} onChange={(e) => mudar(n.id, { compra_minima_90d: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Desconto na tabela (%)">
                  <Input type="number" min={0} max={89} step="0.5" disabled={!podeEditar} value={n.desconto_pct} onChange={(e) => mudar(n.id, { desconto_pct: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Desconto em preço por faixa (%)">
                  <Input type="number" min={0} max={89} step="0.5" disabled={!podeEditar} value={n.desconto_faixa_pct} onChange={(e) => mudar(n.id, { desconto_faixa_pct: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Volta em crédito (%)">
                  <Input type="number" min={0} max={30} step="0.5" disabled={!podeEditar} value={n.cashback_pct} onChange={(e) => mudar(n.id, { cashback_pct: Number(e.target.value) })} />
                </Campo>
              </div>
              <Campo rotulo="Benefícios que o parceiro vê (um por linha)">
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

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}
