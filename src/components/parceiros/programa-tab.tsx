/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Percent, Gift, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { mensagemErro } from "@/lib/erros";
import { brl } from "@/domain/parceiros/preco";

/**
 * As regras do programa de indicação, em números que a gestão troca sem deploy.
 *
 * Cada campo aqui é dinheiro saindo, então a tela mostra o efeito ao lado do
 * campo — quanto custa, no máximo, cada parceiro novo — em vez de pedir que
 * alguém faça a conta de cabeça.
 *
 * Os padrões vêm do estudo de 20/09/2026, calculados sobre a margem real
 * (57,8% média, 51,1% mínima) dos 21 produtos com preço e custo:
 *
 *   indicação 1% × 3 compras, teto R$ 50 · boas-vindas 10%, teto R$ 100,
 *   60 dias · crédito paga até 15% do pedido.
 *
 * O limite por pedido é o que mais importa e o menos óbvio: sem ele, um
 * parceiro junta crédito e leva um trabalho inteiro abaixo do custo.
 */

interface Programa {
  indicacao_ativa: boolean;
  indicacao_pct: number;
  indicacao_compras: number;
  indicacao_teto: number;
  boas_vindas_ativa: boolean;
  boas_vindas_pct: number;
  boas_vindas_teto: number;
  boas_vindas_validade_dias: number;
  credito_max_pct_pedido: number;
}

const CAMPOS: (keyof Programa)[] = [
  "indicacao_ativa", "indicacao_pct", "indicacao_compras", "indicacao_teto",
  "boas_vindas_ativa", "boas_vindas_pct", "boas_vindas_teto",
  "boas_vindas_validade_dias", "credito_max_pct_pedido",
];

export function ProgramaTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [r, setR] = useState<Programa | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["parceiro-programa"],
    queryFn: async (): Promise<Programa> => {
      const { data: d, error } = await (supabase as any)
        .from("parceiro_programa")
        .select(CAMPOS.join(", "))
        .maybeSingle();
      if (error) throw error;
      return d as Programa;
    },
  });

  useEffect(() => {
    if (data) setR(data);
  }, [data]);

  if (isLoading || !r) {
    return <p className="py-6 text-sm text-muted-foreground">Carregando as regras...</p>;
  }

  const num = (k: keyof Programa) => Number(r[k] ?? 0);

  // O teto do que a gráfica pode gastar para trazer um parceiro novo. São os
  // dois tetos somados, porque cada um acontece no máximo uma vez.
  const custoMaximo = (r.indicacao_ativa ? num("indicacao_teto") : 0)
    + (r.boas_vindas_ativa ? num("boas_vindas_teto") : 0);

  async function salvar() {
    if (!r) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any)
        .from("parceiro_programa")
        .update({ ...r, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw error;
      toast.success("Regras salvas. Valem para as próximas compras pagas.");
      qc.invalidateQueries({ queryKey: ["parceiro-programa"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const campo = (k: keyof Programa, rotulo: string, sufixo: string, dica: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          className="h-9 font-mono"
          value={String(r[k] ?? "")}
          disabled={!podeEditar}
          onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{sufixo}</span>
      </div>
      <p className="text-xs text-muted-foreground">{dica}</p>
    </div>
  );

  return (
    <div className="space-y-6 pt-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Custo máximo por parceiro novo</h3>
            <p className="text-sm text-muted-foreground">
              Os dois bônus somados, e só depois de compra paga. Se o indicado nunca comprar,
              o programa não custa nada.
            </p>
          </div>
          <span className="font-mono text-2xl font-bold text-[color:var(--bex-lime)]">
            {brl(custoMaximo)}
          </span>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" />
            Bônus de indicação
          </h3>
          <Switch
            checked={r.indicacao_ativa}
            disabled={!podeEditar}
            onCheckedChange={(v) => setR({ ...r, indicacao_ativa: v })}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Quanto quem indicou ganha quando o indicado compra. Um nível só: quem indicou o
          indicador não ganha nada.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {campo("indicacao_pct", "Percentual da compra", "%",
            "1% é o que cabe: no Diamante a margem já cai a 28,9% no pior caso.")}
          {campo("indicacao_compras", "Vale nas primeiras", "compras",
            "Depois disso para de pagar, mesmo que o indicado siga comprando.")}
          {campo("indicacao_teto", "Teto por indicado", "R$",
            "Soma máxima que um único indicado pode gerar para quem o trouxe.")}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Gift className="h-4 w-4 text-muted-foreground" />
            Boas-vindas do indicado
          </h3>
          <Switch
            checked={r.boas_vindas_ativa}
            disabled={!podeEditar}
            onCheckedChange={(v) => setR({ ...r, boas_vindas_ativa: v })}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Crédito de volta na primeira compra de quem entrou por convite. Só na primeira.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {campo("boas_vindas_pct", "Percentual de volta", "%",
            "A 10% a margem Bronze cai de 50,4% para 40,4%. A 100% ela vai a zero.")}
          {campo("boas_vindas_teto", "Teto", "R$",
            "Quanto a gráfica devolve, no máximo, por parceiro.")}
          {campo("boas_vindas_validade_dias", "Validade", "dias",
            "Sem prazo o crédito vira passivo eterno e perde a urgência que gera a 2ª compra.")}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/5 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Wallet className="h-4 w-4 text-[color:var(--bex-amber)]" />
          Limite de uso por pedido
        </h3>
        <p className="text-sm text-muted-foreground">
          O crédito nunca paga um pedido inteiro: abate até esta fatia de cada pedido, até
          acabar. <strong>É o que mantém a margem acima do piso de 34,5%</strong> em todos os
          níveis — sem ele, um parceiro junta crédito e leva um trabalho abaixo do custo.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {campo("credito_max_pct_pedido", "Máximo por pedido", "%",
            `Num pedido de R$ 1.000, o crédito abate no máximo ${brl(num("credito_max_pct_pedido") * 10)}.`)}
        </div>
      </section>

      {podeEditar && (
        <div className="flex justify-end">
          <Button onClick={salvar} disabled={salvando}>
            <Save className="mr-1 h-4 w-4" />
            {salvando ? "Salvando..." : "Salvar regras"}
          </Button>
        </div>
      )}
    </div>
  );
}
