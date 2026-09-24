/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";

type Orcamento = {
  id: string;
  data_inicio: string | null;
  prazo: string | null;
  data_entrega_prometida: string | null;
  validade_dias: number | null;
  created_at: string | null;
  status: string;
};

const hoje = () => new Date().toISOString().slice(0, 10);

/** Dias entre hoje e a data. Negativo = já passou. */
export function diasAte(data: string | null | undefined): number | null {
  if (!data) return null;
  const alvo = new Date(`${data}T12:00:00`);
  if (Number.isNaN(alvo.getTime())) return null;
  const agora = new Date();
  agora.setHours(12, 0, 0, 0);
  return Math.round((alvo.getTime() - agora.getTime()) / 86400000);
}

/**
 * Prazos do orçamento: quando começa, quando termina, até quando o preço vale.
 *
 * `data_inicio`, `prazo` e `data_entrega_prometida` existem na tabela desde
 * sempre e NENHUMA tela os preenchia — nem esta, nem a lista, nem o PDF. O
 * resultado é um funil que sabe quanto cada oportunidade vale e não sabe quando
 * ela vence: o orçamento esfria e ninguém percebe, porque não havia data
 * nenhuma para comparar.
 *
 * `validade_dias` é o único que vinha preenchido, e sozinho não diz nada — a
 * validade é contada a partir do envio, que também não era gravado.
 */
export function PrazosCard({
  orcamento,
  podeEditar,
}: {
  orcamento: Orcamento;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();

  const salvar = useMutation({
    mutationFn: async (campos: Record<string, unknown>) => {
      const { data, error } = await (supabase as any)
        .from("orcamentos")
        .update(campos)
        .eq("id", orcamento.id)
        .select("id");
      if (error) throw error;
      // Escrita barrada por RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar este orçamento.");
    },
    onSuccess: () => {
      // Salvar no onBlur sem aviso nenhum deixa a dúvida de se gravou.
      toast.success("Prazo salvo");
      qc.invalidateQueries({ queryKey: ["orcamento", orcamento.id] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  const diasPrazo = diasAte(orcamento.prazo);
  const diasEntrega = diasAte(orcamento.data_entrega_prometida);

  // A validade corre a partir do envio; sem envio, a partir da criação.
  // Sem data base não dá para contar: `new Date("T12:00:00")` é inválido e
  // `toISOString()` sobre data inválida derruba a tela inteira.
  const baseValidade = (orcamento.created_at ?? "").slice(0, 10);
  const venceEm =
    orcamento.validade_dias != null && baseValidade
      ? new Date(new Date(`${baseValidade}T12:00:00`).getTime() + orcamento.validade_dias * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
  const diasValidade = diasAte(venceEm);
  const fechado = ["convertido", "aprovado", "recusado", "cancelado"].includes(orcamento.status);

  const campo = (
    id: string,
    rotulo: string,
    valor: string | null,
    chave: string,
    nota?: string,
  ) => (
    <div>
      <Label htmlFor={id} className="text-xs">{rotulo}</Label>
      <Input
        id={id}
        type="date"
        disabled={!podeEditar}
        defaultValue={valor ?? ""}
        onBlur={(e) => {
          const novo = e.target.value || null;
          if (novo !== valor) salvar.mutate({ [chave]: novo });
        }}
      />
      {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Prazos
          {!fechado && diasValidade != null && diasValidade < 0 && (
            <Badge variant="destructive" className="font-normal">
              preço vencido há {Math.abs(diasValidade)}d
            </Badge>
          )}
          {!fechado && diasPrazo != null && diasPrazo < 0 && (
            <Badge variant="destructive" className="font-normal">
              prazo estourado
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {campo(
          "data-inicio",
          "Início da produção",
          orcamento.data_inicio,
          "data_inicio",
          "quando o trabalho começa",
        )}
        {campo(
          "prazo",
          "Prazo final",
          orcamento.prazo,
          "prazo",
          diasPrazo == null
            ? "sem prazo definido"
            : diasPrazo >= 0
              ? `faltam ${diasPrazo} dia(s)`
              : `passou ${Math.abs(diasPrazo)} dia(s)`,
        )}
        {campo(
          "entrega",
          "Entrega prometida",
          orcamento.data_entrega_prometida,
          "data_entrega_prometida",
          diasEntrega == null
            ? "o que foi combinado com o cliente"
            : `${diasEntrega >= 0 ? "faltam" : "passou"} ${Math.abs(diasEntrega)} dia(s)`,
        )}
        <div>
          <Label htmlFor="validade" className="text-xs">Validade do preço (dias)</Label>
          <Input
            id="validade"
            type="number"
            min="0"
            disabled={!podeEditar}
            defaultValue={orcamento.validade_dias ?? ""}
            onBlur={(e) => {
              // `validade_dias` é NOT NULL no banco (padrão 7). Apagar o campo
              // mandava null e voltava "Faltou preencher: validade dias" — e o
              // rodapé ainda prometia um "sem validade" que não existe.
              if (e.target.value === "") {
                e.target.value = String(orcamento.validade_dias ?? 7);
                return toast.error("A validade em dias é obrigatória.");
              }
              const novo = Number(e.target.value);
              if (novo !== orcamento.validade_dias) salvar.mutate({ validade_dias: novo });
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {venceEm
              ? `vence em ${new Date(`${venceEm}T12:00:00`).toLocaleDateString("pt-BR")}`
              : "quantos dias o preço vale a partir da criação"}
          </p>
        </div>
      </CardContent>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          O <strong>prazo final</strong> é o que a OS herda como data de entrega na conversão. Sem
          ele a OS nasce sem data, e o quadro de produção não tem por onde priorizar.
        </p>
      </CardContent>
      {orcamento.data_inicio && orcamento.prazo && orcamento.prazo < orcamento.data_inicio && (
        <CardContent className="pt-0">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
            O prazo final está antes do início da produção. Um dos dois está errado.
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Data de hoje, para preencher o início com um clique. */
export const hojeISO = hoje;
