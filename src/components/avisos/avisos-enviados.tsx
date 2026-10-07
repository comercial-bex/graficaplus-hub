/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/bex/StatusChip";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

const ROTULO: Record<string, string> = {
  os_arte_para_aprovar: "Arte pronta para aprovar",
  os_em_producao: "Entrou em produção",
  os_pronta_retirada: "Pronto para retirar",
  os_saiu_entrega: "Saiu para entrega",
  os_concluida: "Serviço concluído",
  orcamento_aprovado: "Orçamento aprovado",
};

const diaEHora = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR") : "—");

export type AvisoEnviado = {
  id: string;
  evento: string;
  destinatario: string;
  enviado_em: string | null;
  enviado_manualmente: boolean;
  provider_status: string | null;
  entregue_em: string | null;
  lido_em: string | null;
  observacao: string | null;
  variaveis: Record<string, unknown> | null;
  cliente: { nome: string } | null;
};

/** A chave da consulta — a tela de preview e os testes a reaproveitam. */
export const CHAVE_AVISOS_ENVIADOS = ["avisos-enviados"] as const;

/**
 * O que JÁ saiu. `vw_avisos_pendentes` exclui 'enviado' de propósito — ela é a
 * lista de quem falta avisar. Sem esta aba, os avisos entregues (3 em
 * 06/10/2026) não apareciam em tela nenhuma, e "saiu de verdade?" só se
 * respondia no banco.
 */
export function AvisosEnviados() {
  const enviados = useQuery({
    queryKey: CHAVE_AVISOS_ENVIADOS,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notificacoes_fila")
        .select(
          "id, evento, destinatario, enviado_em, enviado_manualmente, provider_status, entregue_em, lido_em, observacao, variaveis, cliente:clientes(nome)",
        )
        .eq("status", "enviado")
        .order("enviado_em", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AvisoEnviado[];
    },
  });

  if (enviados.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não foi possível carregar os avisos enviados"
        erro={enviados.error}
        onTentarDeNovo={() => void enviados.refetch()}
      />
    );
  }
  if (enviados.isPending) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Carregando…</CardContent>
      </Card>
    );
  }
  if (enviados.data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhum aviso saiu ainda. Quando o despachante mandar um, ele aparece aqui com a hora e o
          recibo do WhatsApp.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {enviados.data.length >= 200 && (
        <p className="text-xs text-muted-foreground">Mostrando os 200 mais recentes.</p>
      )}
      {enviados.data.map((a) => {
        const cliente =
          a.cliente?.nome ?? (a.variaveis?.cliente as string | undefined) ?? "sem cliente";
        const recibo = a.lido_em
          ? { label: "lida pelo cliente", tone: "lime" as const }
          : a.entregue_em
            ? { label: "entregue", tone: "cyan" as const }
            : a.enviado_manualmente
              ? { label: "avisado à mão", tone: "muted" as const }
              : { label: "enviada (sem recibo ainda)", tone: "amber" as const };
        return (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{cliente}</span>
                  <Badge variant="outline" className="font-normal">
                    {ROTULO[a.evento] ?? a.evento}
                  </Badge>
                  <StatusChip label={recibo.label} tone={recibo.tone} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {[
                    (a.variaveis?.os_titulo as string | undefined) || null,
                    a.variaveis?.os_numero ? `OS ${String(a.variaveis.os_numero)}` : null,
                    a.variaveis?.orcamento_numero
                      ? `orçamento nº ${String(a.variaveis.orcamento_numero)}`
                      : null,
                    a.destinatario || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saiu em {diaEHora(a.enviado_em)}
                  {a.entregue_em && ` · entregue ${diaEHora(a.entregue_em)}`}
                  {a.lido_em && ` · lida ${diaEHora(a.lido_em)}`}
                  {a.observacao && ` · ${a.observacao}`}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
