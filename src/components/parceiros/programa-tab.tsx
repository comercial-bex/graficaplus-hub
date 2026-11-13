/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Gift, Users, Wallet, Sparkles, Headset } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { mensagemErro } from "@/lib/erros";
import { brl } from "@/domain/parceiros/preco";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fraseDaEntrada } from "@/domain/parceiros/credito-de-entrada";
import { CreditoDeEntradaDialog } from "./credito-de-entrada-dialog";

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
  // Proposta docs/proposta-credito-de-entrada-e-atendente.sql: enquanto não for
  // aplicada, estas colunas não vêm e os blocos delas não aparecem.
  entrada_ativa?: boolean;
  entrada_valor?: number;
  entrada_validade_dias?: number;
  entrada_pedido_minimo?: number;
  entrada_max_pct_pedido?: number;
  atendente_padrao_id?: string | null;
}

const CAMPOS_ENTRADA: (keyof Programa)[] = [
  "entrada_ativa", "entrada_valor", "entrada_validade_dias", "entrada_pedido_minimo", "entrada_max_pct_pedido",
];

type Atendente = { id: string; nome: string; atende: number };

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
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return d as Programa;
    },
  });

  useEffect(() => {
    if (data) setR(data);
  }, [data]);

  const temEntrada = !!data && "entrada_ativa" in data;
  const temAtendente = !!data && "atendente_padrao_id" in data;

  // Quem pode ser atendente padrão: usuários ativos da equipe (não os logins de
  // parceiro), com quantos parceiros cada um já atende.
  const atendentes = useQuery({
    queryKey: ["parceiro-atendentes-possiveis"],
    enabled: temAtendente,
    queryFn: async (): Promise<Atendente[]> => {
      const [us, ps] = await Promise.all([
        (supabase as any).from("usuarios").select("id, nome").eq("ativo", true),
        (supabase as any).from("parceiros").select("usuario_id, responsavel_id"),
      ]);
      if (us.error) throw us.error;
      if (ps.error) throw ps.error;
      const logins = new Set((ps.data ?? []).map((p: any) => p.usuario_id).filter(Boolean));
      const conta = new Map<string, number>();
      for (const p of ps.data ?? []) if (p.responsavel_id) conta.set(p.responsavel_id, (conta.get(p.responsavel_id) ?? 0) + 1);
      return (us.data ?? [])
        .filter((u: any) => !logins.has(u.id))
        .map((u: any) => ({ id: u.id, nome: u.nome || "Sem nome", atende: conta.get(u.id) ?? 0 }))
        .sort((a: Atendente, b: Atendente) => b.atende - a.atende || a.nome.localeCompare(b.nome, "pt-BR"));
    },
  });

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
      // Só as colunas que esta tela edita e que o banco já tem.
      const campos = [
        ...CAMPOS,
        ...(temEntrada ? CAMPOS_ENTRADA : []),
        ...(temAtendente ? (["atendente_padrao_id"] as (keyof Programa)[]) : []),
      ];
      const dados = Object.fromEntries(campos.map((k) => [k, r[k]]));
      const { error } = await (supabase as any)
        .from("parceiro_programa")
        .update({ ...dados, updated_at: new Date().toISOString() })
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

      {temEntrada && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Crédito de entrada
            </h3>
            <Switch
              checked={!!r.entrada_ativa}
              disabled={!podeEditar}
              onCheckedChange={(v) => setR({ ...r, entrada_ativa: v })}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {fraseDaEntrada({
              valor: num("entrada_valor"),
              validade_dias: num("entrada_validade_dias"),
              pedido_minimo: num("entrada_pedido_minimo"),
              max_pct: num("entrada_max_pct_pedido"),
            })}{" "}
            Ele nunca paga sozinho: o dinheiro de verdade cobre pelo menos o mesmo valor do crédito.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {campo("entrada_valor", "Valor", "R$", "Quanto o parceiro ganha ao ser ativado. Uma vez por pessoa.")}
            {campo("entrada_validade_dias", "Validade", "dias", "De 1 a 365. Prazo curto cria urgência para a 1ª compra.")}
            {campo("entrada_pedido_minimo", "1ª compra mínima", "R$", "Em produtos. Não pode ser menor que o valor do crédito.")}
            {campo("entrada_max_pct_pedido", "Cobre até", "%", "Na 1ª compra. Máximo 50%: acima disso o crédito pagaria mais que o dinheiro.")}
          </div>
          {podeEditar && (
            <div className="flex justify-end">
              <CreditoDeEntradaDialog valor={num("entrada_valor")} disabled={!data?.entrada_ativa} />
            </div>
          )}
        </section>
      )}

      {temAtendente && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Headset className="h-4 w-4 text-muted-foreground" />
            Atendente padrão
          </h3>
          <p className="text-sm text-muted-foreground">
            Todo parceiro que entra sem atendente vai para esta pessoa. Sem atendente, o parceiro não
            consegue fazer o primeiro pedido.
          </p>
          <div className="max-w-sm">
            <Select
              value={r.atendente_padrao_id ?? "nenhum"}
              disabled={!podeEditar}
              onValueChange={(v) => setR({ ...r, atendente_padrao_id: v === "nenhum" ? null : v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Escolha quem atende" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Ninguém (cada um assume pela fila)</SelectItem>
                {(atendentes.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome}{a.atende > 0 ? ` · atende ${a.atende}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
      )}

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
