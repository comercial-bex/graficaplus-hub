/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageCircle, Send, AlertTriangle, RefreshCw, CheckCheck, BellRing } from "lucide-react";
import { toast } from "sonner";
import { ConexaoZapi } from "@/components/whatsapp/conexao-zapi";
import { DiagnosticoWebhooks } from "@/components/whatsapp/diagnostico-webhooks";
import {
  AvisoNotificarEnviadas,
  ConectarPorQrCode,
  ReprocessarSemTexto,
} from "@/components/whatsapp/ferramentas-monitor";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import {
  ConfiguracaoDoAssistente,
  DecisoesDoAssistente,
  FilasDaEquipe,
} from "@/components/whatsapp/assistente-monitor";
import { acionarEnvio } from "@/components/whatsapp/usar-caixa-de-entrada";
import { desfechoDoEnvio } from "@/domain/whatsapp/caixa-de-entrada";

export const Route = createFileRoute("/_authenticated/whatsapp-monitor")({
  head: () => ({ meta: [{ title: "Monitor WhatsApp — BEX PRINT OS" }] }),
  component: WhatsappMonitorPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
});

function toneForStatus(s: string): "cyan" | "magenta" | "lime" | "muted" {
  if (s === "entregue" || s === "lida" || s === "enviada" || s === "enviado") return "lime";
  if (s === "erro" || s === "falha" || s === "falhou") return "magenta";
  if (s === "pendente" || s === "fila" || s === "enviando") return "cyan";
  return "muted";
}

const ROTULO_AVISO: Record<string, string> = {
  orcamento_aprovado: "Orçamento aprovado",
  os_arte_para_aprovar: "Arte pronta para aprovar",
  os_em_producao: "Entrou em produção",
  os_pronta_retirada: "Pronto para retirar",
  os_saiu_entrega: "Saiu para entrega",
  os_concluida: "Serviço concluído",
};

type OsDoMonitor = {
  id: string;
  numero: number;
  titulo: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  orcamento_id: string | null;
};

/**
 * Monitor do WhatsApp por OS.
 *
 * TRÊS MENTIRAS CORRIGIDAS EM 06/10/2026:
 *   1. Toda consulta jogava o `error` fora: banco fora virava "Sem mensagens
 *      registradas para esta OS" — e a pessoa concluía que nada foi mandado.
 *      Agora erro é erro (FalhaDeConsulta).
 *   2. O bloco por OS lia só `whatsapp_mensagens.os_id`, coluna que 0 das 5
 *      mensagens tinham. Os avisos automáticos ao cliente (orçamento aprovado,
 *      em produção…) moram em `notificacoes_fila`, por `entidade_id` = a OS ou
 *      o orçamento que a gerou — e é isso que o bloco mostra agora, em todos
 *      os status (pendente, enviado, falhou, cancelado).
 *   3. "Reenviar" gravava `payload: msg.payload ?? { texto }` — e `msg.payload`
 *      era o ponteiro do webhook, sem texto: o consumidor recusava "mensagem
 *      sem texto". E não chamava o envio: só "reenfileirava". Agora monta
 *      `{ tipo: "texto", texto }`, recusa se já há linha pendente da mesma
 *      mensagem, grava `created_by` (a policy exige), confere que o UPDATE
 *      alterou a linha e aciona o envio na hora.
 */
function WhatsappMonitorPage() {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const podeReenviar = hasPermission("whatsapp.reply");
  const [osId, setOsId] = useState<string>("");
  const [reenviando, setReenviando] = useState<string | null>(null);

  const ordens = useQuery({
    queryKey: ["os-para-monitor"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, cliente_id, cliente_nome, orcamento_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as OsDoMonitor[];
    },
  });

  const os = (ordens.data ?? []).find((o) => o.id === osId) ?? null;
  // As duas chaves do aviso: a OS e o orçamento de onde ela veio.
  const idsDoAviso = os ? [os.id, ...(os.orcamento_id ? [os.orcamento_id] : [])] : [];

  const mensagens = useQuery({
    queryKey: ["wa-msgs-os", osId],
    enabled: !!osId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_mensagens")
        .select(
          "id, conversa_id, direcao, tipo, status, texto, legenda, erro, created_at, enviado_em, recebido_em",
        )
        .eq("os_id", osId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const avisos = useQuery({
    queryKey: ["wa-avisos-os", osId, idsDoAviso.join(",")],
    enabled: idsDoAviso.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notificacoes_fila")
        .select(
          "id, evento, entidade, entidade_id, status, destinatario, tentativas, ultimo_erro, enviado_em, provider_status, entregue_em, lido_em, enviado_manualmente, created_at",
        )
        .eq("canal", "whatsapp")
        .in("entidade_id", idsDoAviso)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const idsDasMensagens = (mensagens.data ?? []).map((m: any) => m.id as string);
  const fila = useQuery({
    queryKey: ["wa-fila-os", osId, idsDasMensagens.join(",")],
    enabled: idsDasMensagens.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_fila_envio")
        .select("id, mensagem_id, status, tentativas, erro, idempotency_key, created_at")
        .in("mensagem_id", idsDasMensagens)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const lista = mensagens.data ?? [];
  const total = lista.length;
  const erros = lista.filter((m: any) => m.status === "erro" || m.status === "falha").length;
  const enviadas = lista.filter((m: any) =>
    ["enviada", "entregue", "lida"].includes(m.status),
  ).length;
  const pendentes = lista.filter((m: any) =>
    ["pendente", "fila", "recebida"].includes(m.status),
  ).length;

  async function reenviar(msg: any) {
    if (!user) return;
    const texto = (msg.texto ?? "").trim();
    if (!texto) {
      toast.error("Esta mensagem não tem texto para reenviar.");
      return;
    }
    setReenviando(msg.id);
    try {
      // Já há uma linha da fila esperando por esta mensagem? Enfileirar outra
      // mandaria duas vezes quando a primeira saísse.
      const { data: abertas, error: erroAbertas } = await (supabase as any)
        .from("whatsapp_fila_envio")
        .select("id, status")
        .eq("mensagem_id", msg.id)
        .in("status", ["pendente", "enviando"]);
      if (erroAbertas) throw erroAbertas;
      if ((abertas ?? []).length > 0) {
        toast.warning("Esta mensagem já está na fila de envio. Aguarde a próxima rodada.");
        return;
      }

      const { data: linha, error: erroFila } = await (supabase as any)
        .from("whatsapp_fila_envio")
        .insert({
          conversa_id: msg.conversa_id,
          mensagem_id: msg.id,
          payload: { tipo: "texto", texto },
          idempotency_key: `resend-${msg.id}-${Date.now()}`,
          status: "pendente",
          created_by: user.id,
        })
        .select("id")
        .single();
      if (erroFila) throw erroFila;

      // UPDATE que o RLS barra não dá erro: devolve zero linhas.
      const { data: alteradas, error: erroMensagem } = await (supabase as any)
        .from("whatsapp_mensagens")
        .update({ status: "pendente", erro: null })
        .eq("id", msg.id)
        .select("id");
      if (erroMensagem) throw erroMensagem;
      if (!alteradas || alteradas.length === 0) {
        throw new Error(
          "A mensagem não pôde ser marcada como pendente (seu perfil não altera mensagens).",
        );
      }

      const http = await acionarEnvio();
      const d = desfechoDoEnvio(http, linha.id, msg.id);
      if (d.tom === "sucesso") toast.success(d.texto);
      else if (d.tom === "erro") toast.error(d.texto);
      else toast.warning(d.texto);
    } catch (e) {
      toast.error(`Falha ao reenviar: ${mensagemErro(e)}`);
    } finally {
      setReenviando(null);
      qc.invalidateQueries({ queryKey: ["wa-msgs-os", osId] });
      qc.invalidateQueries({ queryKey: ["wa-fila-os", osId] });
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/whatsapp-monitor")}
        breadcrumb="Atendimento · WhatsApp"
        title="Monitor do WhatsApp por OS"
        description="A conexão, o que a entrada está devendo, e as mensagens e avisos de cada ordem de serviço"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["wa-msgs-os", osId] });
              qc.invalidateQueries({ queryKey: ["wa-avisos-os", osId] });
            }}
            disabled={!osId}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        }
      />

      <AvisoNotificarEnviadas />
      <ConexaoZapi />
      <ConectarPorQrCode />
      <div className="flex justify-end">
        <ReprocessarSemTexto />
      </div>
      <ConfiguracaoDoAssistente />
      <DecisoesDoAssistente />
      <FilasDaEquipe />
      <DiagnosticoWebhooks />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selecionar OS</CardTitle>
        </CardHeader>
        <CardContent>
          {ordens.isError ? (
            <FalhaDeConsulta
              titulo="Não foi possível carregar as ordens de serviço"
              erro={ordens.error}
              onTentarDeNovo={() => void ordens.refetch()}
            />
          ) : (
            <Select value={osId} onValueChange={setOsId} disabled={ordens.isPending}>
              <SelectTrigger className="w-full md:w-[480px]">
                <SelectValue
                  placeholder={ordens.isPending ? "Carregando…" : "Escolha uma ordem de serviço..."}
                />
              </SelectTrigger>
              <SelectContent>
                {(ordens.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    #{o.numero} · {o.titulo} · {o.cliente_nome ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {osId && (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Mensagens da conversa" value={total} icon={MessageCircle} tone="cyan" />
            <KpiCard label="Enviadas" value={enviadas} icon={CheckCheck} tone="lime" />
            <KpiCard label="Pendentes / fila" value={pendentes} icon={Send} tone="cyan" />
            <KpiCard
              label="Erros"
              value={erros}
              icon={AlertTriangle}
              tone={erros > 0 ? "magenta" : "muted"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="h-4 w-4" /> Avisos automáticos desta OS e do seu orçamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              {avisos.isError ? (
                <FalhaDeConsulta
                  titulo="Não foi possível carregar os avisos"
                  erro={avisos.error}
                  onTentarDeNovo={() => void avisos.refetch()}
                />
              ) : avisos.isPending ? (
                <p className="text-center py-6 text-muted-foreground text-sm">Carregando...</p>
              ) : (avisos.data ?? []).length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum aviso automático foi gerado para esta OS
                  {os?.orcamento_id ? " nem para o orçamento dela" : ""}. Os avisos nascem quando o
                  orçamento é aprovado e quando a OS muda de etapa.
                </p>
              ) : (
                <div className="space-y-2">
                  {(avisos.data ?? []).map((a: any) => (
                    <div key={a.id} className="rounded border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium">{ROTULO_AVISO[a.evento] ?? a.evento}</span>
                        <StatusChip
                          label={a.enviado_manualmente ? "avisado à mão" : a.status}
                          tone={a.enviado_manualmente ? "muted" : toneForStatus(a.status)}
                        />
                        {a.provider_status && (
                          <StatusChip
                            label={a.provider_status}
                            tone={toneForStatus(a.provider_status)}
                          />
                        )}
                        <span className="text-xs text-muted-foreground font-mono">
                          {a.entidade === "orcamento" ? "pelo orçamento" : "pela OS"} ·{" "}
                          {new Date(a.enviado_em ?? a.created_at).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        para {a.destinatario} · {a.tentativas} tentativa(s)
                        {a.lido_em
                          ? ` · lido ${new Date(a.lido_em).toLocaleString("pt-BR")}`
                          : a.entregue_em
                            ? ` · entregue ${new Date(a.entregue_em).toLocaleString("pt-BR")}`
                            : ""}
                      </div>
                      {a.ultimo_erro && (
                        <div className="mt-1 text-xs text-destructive font-mono">
                          ⚠ {a.ultimo_erro}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mensagens da conversa ligada a esta OS</CardTitle>
            </CardHeader>
            <CardContent>
              {mensagens.isError ? (
                <FalhaDeConsulta
                  titulo="Não foi possível carregar as mensagens"
                  erro={mensagens.error}
                  onTentarDeNovo={() => void mensagens.refetch()}
                />
              ) : mensagens.isPending ? (
                <p className="text-center py-6 text-muted-foreground text-sm">Carregando...</p>
              ) : lista.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  Nenhuma mensagem de conversa está ligada a esta OS. Isto não quer dizer que nada
                  foi mandado: os avisos automáticos estão no bloco acima, e a conversa só fica
                  ligada à OS quando é aberta a partir dela na caixa de entrada.
                </p>
              ) : (
                <div className="space-y-2">
                  {lista.map((m: any) => (
                    <div key={m.id} className="rounded border p-3 text-sm flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">
                            {m.direcao} · {m.tipo}
                          </span>
                          <StatusChip label={m.status} tone={toneForStatus(m.status)} />
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(m.created_at).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <div className="line-clamp-2 text-foreground">
                          {m.texto ?? m.legenda ?? "(mídia)"}
                        </div>
                        {m.erro && (
                          <div className="mt-1 text-xs text-destructive font-mono">⚠ {m.erro}</div>
                        )}
                      </div>
                      {podeReenviar &&
                        (m.status === "erro" || m.status === "falha" || m.status === "pendente") &&
                        m.direcao === "saida" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reenviando === m.id}
                            onClick={() => reenviar(m)}
                          >
                            <RefreshCw
                              className={`h-3 w-3 mr-1 ${reenviando === m.id ? "animate-spin" : ""}`}
                            />{" "}
                            Reenviar
                          </Button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {fila.isError ? (
            <FalhaDeConsulta
              titulo="Não foi possível carregar a fila de envio"
              erro={fila.error}
              onTentarDeNovo={() => void fila.refetch()}
            />
          ) : (
            (fila.data ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Fila de envio</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(fila.data ?? []).map((f: any) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between rounded border p-2 font-mono text-xs"
                    >
                      <span className="truncate">
                        {f.idempotency_key}
                        {f.erro ? ` · ${f.erro}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">tent. {f.tentativas}</span>
                        <StatusChip label={f.status} tone={toneForStatus(f.status)} />
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          )}
        </>
      )}
    </div>
  );
}
