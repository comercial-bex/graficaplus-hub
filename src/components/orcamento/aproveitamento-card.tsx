import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Ruler } from "lucide-react";
import {
  planejarBobina,
  type ResultadoBobina,
} from "@/domain/producao/aproveitamento-bobina";

type Contexto = {
  larguraBobina: number | null;
  comprimentoBobina: number | null;
  nomeBobina: string | null;
  espacamento: number;
  larguraUtilMaquina: number | null;
  margemLateral: number;
  nomeMaquina: string | null;
};

/**
 * O que a produção precisa saber para planejar: qual bobina o produto consome e
 * qual a boca da máquina que vai imprimir.
 *
 * A largura da máquina vem da impressora ativa mais larga — é ela que define o
 * teto. Trocar por uma escolha explícita de máquina é o passo seguinte, quando
 * houver mais de uma no parque.
 */
export function useContextoDeBobina(produtoId: string | null) {
  return useQuery({
    queryKey: ["contexto-bobina", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<Contexto | null> => {
      const { data: produto } = await (supabase as any)
        .from("produtos")
        .select(
          "espacamento_pecas_m, materiais:material_principal_id(nome, largura_bobina_m, comprimento_bobina_m)",
        )
        .eq("id", produtoId)
        .maybeSingle();
      if (!produto) return null;

      const { data: maquinas } = await (supabase as any)
        .from("maquinas")
        .select("nome, largura_util_m, margem_lateral_m")
        .eq("ativa", true)
        .not("largura_util_m", "is", null)
        .order("largura_util_m", { ascending: false })
        .limit(1);
      const maquina = maquinas?.[0];
      const bobina = produto.materiais;

      return {
        larguraBobina: bobina?.largura_bobina_m != null ? Number(bobina.largura_bobina_m) : null,
        comprimentoBobina:
          bobina?.comprimento_bobina_m != null ? Number(bobina.comprimento_bobina_m) : null,
        nomeBobina: bobina?.nome ?? null,
        espacamento: Number(produto.espacamento_pecas_m ?? 0.003),
        larguraUtilMaquina: maquina?.largura_util_m != null ? Number(maquina.largura_util_m) : null,
        margemLateral: Number(maquina?.margem_lateral_m ?? 0.01),
        nomeMaquina: maquina?.nome ?? null,
      };
    },
  });
}

const m = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Quantas peças saem da bobina que está na máquina.
 *
 * Substitui o aviso de "cabem N por veículo", que respondia a pergunta errada:
 * o limite eleitoral é de aplicação, e quem faz o pedido precisa saber é o que a
 * máquina consegue produzir e quanto material vai embora.
 */
export function AproveitamentoDeBobina({
  contexto,
  largura,
  altura,
  quantidade,
}: {
  contexto: Contexto | null | undefined;
  largura: number;
  altura: number;
  quantidade: number;
}) {
  if (!contexto || largura <= 0 || altura <= 0 || quantidade <= 0) return null;

  if (contexto.larguraBobina == null || contexto.larguraUtilMaquina == null) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          Para calcular o aproveitamento, cadastre{" "}
          {contexto.larguraBobina == null && <strong>a largura da bobina no material</strong>}
          {contexto.larguraBobina == null && contexto.larguraUtilMaquina == null && " e "}
          {contexto.larguraUtilMaquina == null && (
            <strong>a largura de impressão da máquina</strong>
          )}
          .
        </div>
      </div>
    );
  }

  const r: ResultadoBobina = planejarBobina({
    larguraPeca: largura,
    alturaPeca: altura,
    quantidade,
    larguraBobina: contexto.larguraBobina,
    larguraUtilMaquina: contexto.larguraUtilMaquina,
    margemLateral: contexto.margemLateral,
    espacamento: contexto.espacamento,
  });

  if (!r.cabe) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
        <div>{r.motivo}</div>
      </div>
    );
  }

  const p = r.plano;
  const rolos =
    contexto.comprimentoBobina && contexto.comprimentoBobina > 0
      ? p.metrosLineares / contexto.comprimentoBobina
      : null;
  // Abaixo de 70% a faixa lateral que sobra já pesa no custo — vale conferir se
  // outra medida ou outra bobina aproveita melhor.
  const desperdicio = p.aproveitamentoPct < 0.7;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Ruler className="h-4 w-4 text-muted-foreground" />
        <Badge variant="secondary" className="font-normal">
          {p.colunas} por fileira
        </Badge>
        <span>
          <strong>{p.linhas}</strong> {p.linhas === 1 ? "fileira" : "fileiras"} ·{" "}
          <strong>{m(p.metrosLineares)}</strong> lineares
        </span>
        {p.orientacao === "girada" && (
          <Badge variant="outline" className="font-normal">
            peça girada 90°
          </Badge>
        )}
      </div>

      <div className="text-muted-foreground">
        Bobina {contexto.nomeBobina ?? "—"} de {m(contexto.larguraBobina)}
        {contexto.nomeMaquina && ` na ${contexto.nomeMaquina}`} · consome{" "}
        <strong className="text-foreground">
          {p.m2Consumidos.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²
        </strong>{" "}
        de material
        {rolos != null && rolos > 0 && (
          <>
            {" "}
            ({rolos < 1 ? `${pct(rolos)} de um rolo` : `${rolos.toFixed(1)} rolos`})
          </>
        )}
      </div>

      <div className={desperdicio ? "text-amber-600" : "text-muted-foreground"}>
        Aproveitamento <strong>{pct(p.aproveitamentoPct)}</strong> · sobram{" "}
        {(p.sobraLateral * 100).toFixed(1)} cm de faixa lateral em todo o comprimento
        {desperdicio && " — vale testar outra medida ou outra bobina"}
      </div>
    </div>
  );
}
