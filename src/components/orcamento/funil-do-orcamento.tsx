/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Funil = {
  dias: number;
  criados: number;
  enviados: number;
  vistos?: number;
  horas_enviar_ate_ver?: number | null;
  aprovados: number;
  viraram_os: number;
  rascunhos_sem_cliente: number;
  aprovados_sem_os: number;
  horas_criar_ate_enviar: number | null;
  horas_enviar_ate_aprovar: number | null;
  horas_aprovar_ate_os: number | null;
  pct_os_em_24h: number | null;
};

function horas(h: number | null): string {
  if (h == null) return "—";
  return h >= 48 ? `${(h / 24).toFixed(1).replace(".", ",")} dias` : `${String(h).replace(".", ",")} h`;
}

/** O funil do orçamento à OS dos últimos 30 dias: contagens e tempos médios, sem valores. */
export function FunilDoOrcamento() {
  const { data, isError } = useQuery({
    queryKey: ["painel-funil-orcamentos", 30],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("painel_funil_orcamentos", { p_dias: 30 });
      if (error) throw error;
      return data as Funil;
    },
  });
  if (isError || !data) return null;

  const itens = [
    { rotulo: "Criar até enviar", valor: horas(data.horas_criar_ate_enviar) },
    { rotulo: "Enviar até o cliente abrir", valor: horas(data.horas_enviar_ate_ver ?? null) },
    { rotulo: "Enviar até aprovar", valor: horas(data.horas_enviar_ate_aprovar) },
    { rotulo: "Aprovar até virar OS", valor: horas(data.horas_aprovar_ate_os) },
    { rotulo: "Aprovados que viram OS em 24 h", valor: data.pct_os_em_24h == null ? "—" : `${data.pct_os_em_24h}%` },
  ];

  return (
    <Card data-testid="funil-do-orcamento">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Do orçamento à OS · últimos {data.dias} dias
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {data.criados} criados · {data.enviados} enviados{data.vistos != null ? ` · ${data.vistos} vistos pelo cliente` : ""} · {data.aprovados} aprovados · {data.viraram_os} viraram OS
          {data.aprovados_sem_os > 0 ? ` · ${data.aprovados_sem_os} aprovados esperando OS` : ""}
          {data.rascunhos_sem_cliente > 0 ? ` · ${data.rascunhos_sem_cliente} rascunhos sem cliente` : ""}
        </p>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {itens.map((i) => (
            <div key={i.rotulo}>
              <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
              <dd className="text-lg font-semibold tabular-nums">{i.valor}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
