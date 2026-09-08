/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { AlertTriangle, BellRing, Check, Clock, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/avisos")({
  head: () => ({ meta: [{ title: "Avisos ao cliente — BEX PRINT OS" }] }),
  component: AvisosPage,
});

const dia = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

const ROTULO: Record<string, string> = {
  os_arte_para_aprovar: "Arte pronta para aprovar",
  os_concluida: "Serviço concluído",
  orcamento_aprovado: "Orçamento aprovado",
};

/**
 * Avisos ao cliente que ainda não saíram.
 *
 * A fila `notificacoes_fila` existia, enchia sozinha a cada arte pronta, OS
 * concluída e orçamento aprovado — e NENHUMA tela do sistema lia ela. Doze
 * avisos se acumularam desde agosto com ZERO tentativa de envio: não há
 * instância de WhatsApp conectada nem função que drene a fila.
 *
 * Fila que só enche é pior que fila que falha: a que falha deixa erro, a que
 * nunca é tentada não deixa rastro nenhum. Enquanto o canal automático não
 * existe, esta tela transforma a fila no que ela é hoje de verdade — uma lista
 * de quem precisa ser avisado à mão.
 *
 * Por isso `enviado_manualmente` é coluna separada: marcar como "enviado" sem
 * ela faria o sistema reivindicar um envio que ele não fez.
 */
function AvisosPage() {
  const qc = useQueryClient();

  const { data: avisos = [], isLoading } = useQuery({
    queryKey: ["avisos-pendentes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vw_avisos_pendentes")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["avisos-pendentes"] });

  const avisar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("avisar_manualmente", {
        p_id: id,
        p_observacao: "avisado à mão pela equipe",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marcado como avisado à mão");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("cancelar_aviso", { p_id: id, p_motivo: null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aviso cancelado");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const limparOrfaos = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("cancelar_avisos_orfaos");
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      // Contar o que a escrita fez: "limpou" sem número esconde o caso de zero.
      const n = Number(r?.cancelados ?? 0);
      if (n === 0) toast.info("Nenhum aviso órfão para limpar");
      else toast.success(`${n} aviso(s) sem cliente cancelado(s)`);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Sem vínculo é fato do dado (cliente_id nulo). "Não visível" seria conclusão
  // sobre RLS, e esta view roda com a permissão de quem chama.
  const orfaos = avisos.filter((a) => a.sem_vinculo);
  const reais = avisos.filter((a) => !a.sem_vinculo);
  const nuncaTentados = avisos.filter((a) => a.nunca_tentado).length;
  const canalOk = avisos[0]?.whatsapp_configurado ?? false;
  const maisAntigo = reais.reduce((m, a) => Math.max(m, Number(a.dias_parado ?? 0)), 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Avisos ao cliente"
        description="O que o sistema registrou que precisava ser comunicado e ainda não saiu"
        actions={
          orfaos.length > 0 ? (
            <Button variant="outline" disabled={limparOrfaos.isPending} onClick={() => limparOrfaos.mutate()}>
              <Trash2 className="h-4 w-4 mr-1" /> Limpar {orfaos.length} sem cliente
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Avisos parados" value={String(avisos.length)} icon={BellRing} />
        <KpiCard label="Com cliente vinculado" value={String(reais.length)} icon={AlertTriangle} />
        <KpiCard label="Nunca tentados" value={String(nuncaTentados)} icon={Clock} />
        <KpiCard label="Mais antigo" value={maisAntigo > 0 ? `${maisAntigo} dias` : "—"} icon={Clock} />
      </div>

      {/* A causa raiz, dita uma vez e no topo. Sem isto a tela vira uma lista de
          tarefas eternas: a pessoa avisa à mão, e amanhã a fila enche de novo. */}
      {!canalOk && avisos.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Nenhum canal de envio está configurado</strong>, e é por isso que estes
            avisos nunca foram tentados — não é erro de envio, é ausência de canal. Nenhuma
            instância de WhatsApp está conectada. Enquanto isso não muda, esta tela é a
            lista de quem precisa ser avisado <em>à mão</em>, e a fila vai continuar
            enchendo a cada arte pronta, OS concluída e orçamento aprovado.
          </div>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Carregando…</CardContent>
        </Card>
      ) : avisos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum aviso parado. Tudo que o sistema quis comunicar já saiu ou foi resolvido.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...reais, ...orfaos].map((a) => (
            <Card key={a.id} className={a.sem_vinculo ? "opacity-60" : ""}>
              <CardContent className="p-4 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.cliente ?? "sem cliente"}</span>
                    <Badge variant="outline" className="font-normal">
                      {ROTULO[a.evento] ?? a.evento}
                    </Badge>
                    {a.sem_vinculo && (
                      <Badge variant="secondary" className="gap-1">
                        <UserX className="h-3 w-3" /> sem cliente vinculado
                      </Badge>
                    )}
                    {a.nunca_tentado && (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-500 hover:bg-amber-500/15">
                        nunca tentado
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {a.titulo && a.titulo !== "—" ? a.titulo : "—"}
                    {a.os_numero && ` · OS ${a.os_numero}`}
                    {a.destinatario && ` · ${a.destinatario}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Na fila desde {dia(a.created_at)} · {a.dias_parado} dia(s) · canal {a.canal}
                    {a.ultimo_erro && ` · último erro: ${a.ultimo_erro}`}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={avisar.isPending}
                    onClick={() => avisar.mutate(a.id)}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Já avisei
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Cancelar aviso"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate(a.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
