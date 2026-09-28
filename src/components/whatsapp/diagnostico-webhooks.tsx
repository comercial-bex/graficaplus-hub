import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, CheckCircle2, CircleDashed, History, Stethoscope, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  detalheDoEvento,
  estadoDosWebhooks,
  rotuloDoTipo,
  situacaoDoEvento,
  tipoDoEvento,
  WEBHOOKS,
  type EventoGravado,
} from "@/domain/whatsapp/diagnostico-webhooks";
import { verificarConexaoZapi, type ResultadoVerificacao } from "@/lib/api/whatsapp-verificar.functions";

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR");
const TOM = { processado: "lime", erro: "magenta", pendente: "cyan" } as const;
const TEMPO_TESTE_MS = 90_000;

export function DiagnosticoWebhooks() {
  const qc = useQueryClient();
  const verificar = useServerFn(verificarConexaoZapi);
  const [resultado, setResultado] = useState<ResultadoVerificacao | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroSit, setFiltroSit] = useState("todos");
  const [aberto, setAberto] = useState<string | null>(null);

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["whatsapp-webhook-eventos"],
    refetchInterval: aguardando ? 4000 : 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_webhook_eventos")
        .select("id, created_at, processado_em, erro, payload")
        .eq("provedor", "zapi")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EventoGravado[];
    },
  });

  useEffect(() => {
    if (!aguardando) return;
    const t = setTimeout(() => setAguardando(false), TEMPO_TESTE_MS);
    return () => clearTimeout(t);
  }, [aguardando]);

  const estados = useMemo(() => estadoDosWebhooks(eventos, resultado?.inicio), [eventos, resultado]);

  const filtrados = eventos.filter(
    (e) =>
      (filtroTipo === "todos" || tipoDoEvento(e.payload) === filtroTipo) &&
      (filtroSit === "todos" || situacaoDoEvento(e) === filtroSit),
  );

  async function rodar() {
    setVerificando(true);
    try {
      const r = await verificar();
      setResultado(r);
      setAguardando(r.testeEnviado);
      qc.invalidateQueries({ queryKey: ["whatsapp-instancias"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-alertas"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setVerificando(false);
    }
  }

  function veredito(w: (typeof estados)[number]) {
    if (w.noTeste) return { tom: "lime" as const, txt: "Funcionando (chegou no teste)" };
    if (aguardando && (w.chave === "receber" || w.chave === "status"))
      return { tom: "cyan" as const, txt: "Aguardando o teste…" };
    if (resultado?.testeEnviado && !aguardando && w.chave === "status")
      return { tom: "magenta" as const, txt: "Não chegou — confira este campo no Z-API" };
    if (w.erros > 0 && w.erros === w.total) return { tom: "magenta" as const, txt: "Chega, mas falha ao processar" };
    if (w.ultimo) return { tom: "lime" as const, txt: "Já recebeu eventos" };
    if (w.chave === "conectar" || w.chave === "desconectar")
      return { tom: "muted" as const, txt: "Só dispara ao conectar/desconectar o celular" };
    return { tom: "amber" as const, txt: "Nunca recebeu — cole o endereço neste campo" };
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" /> Verificação de conexão
          </CardTitle>
          <Button size="sm" onClick={rodar} disabled={verificando || aguardando}>
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            {verificando ? "Verificando…" : aguardando ? "Aguardando eventos…" : "Verificar agora"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Pergunta ao Z-API se a instância está conectada e manda uma mensagem de teste para o próprio número
            da empresa. Em até 90 segundos mostramos quais webhooks responderam.
          </p>
          {resultado && (
            <div className="grid gap-2 rounded border border-border/60 bg-muted/30 p-3 text-xs md:grid-cols-2">
              <Linha ok={resultado.credenciais} txt={resultado.credenciais ? "Token do Z-API configurado" : "Token do Z-API ausente no servidor"} />
              <Linha
                ok={resultado.conectado}
                txt={
                  resultado.conectado === null
                    ? `Status não obtido${resultado.erroStatus ? `: ${resultado.erroStatus}` : ""}`
                    : resultado.conectado
                      ? "Instância conectada no Z-API"
                      : `Instância desconectada — leia o QR Code${resultado.erroStatus ? ` (${resultado.erroStatus})` : ""}`
                }
              />
              {resultado.celularConectado === false && <Linha ok={false} txt="O celular está sem internet" />}
              <Linha
                ok={resultado.testeEnviado ? true : resultado.erroTeste ? false : null}
                txt={resultado.testeEnviado ? "Mensagem de teste enviada" : resultado.erroTeste ?? "Teste não enviado"}
              />
            </div>
          )}
          <div className="divide-y divide-border/60 rounded border border-border/60">
            {estados.map((w) => {
              const v = veredito(w);
              return (
                <div key={w.chave} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                  <div>
                    <div className="font-medium text-foreground">{w.rotulo}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {w.ultimo ? `último: ${fmt(w.ultimo)} · ${w.total} evento(s)` : "nenhum evento"}
                      {w.erros > 0 ? ` · ${w.erros} com falha` : ""}
                    </div>
                  </div>
                  <StatusChip label={v.txt} tone={v.tom} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Histórico de eventos do webhook
          </CardTitle>
          <div className="flex gap-2">
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {WEBHOOKS.map((w) => (
                  <SelectItem key={w.tipo} value={w.tipo}>{rotuloDoTipo(w.tipo)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroSit} onValueChange={setFiltroSit}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as situações</SelectItem>
                <SelectItem value="processado">Processado</SelectItem>
                <SelectItem value="erro">Com erro</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum evento recebido{eventos.length ? " com esse filtro" : " até agora"}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left font-mono text-[10px] uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Horário</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Situação</th>
                    <th className="py-2">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((e) => {
                    const sit = situacaoDoEvento(e);
                    return (
                      <tr
                        key={e.id}
                        className="cursor-pointer border-b border-border/40 align-top hover:bg-muted/30"
                        onClick={() => setAberto(aberto === e.id ? null : e.id)}
                      >
                        <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">{fmt(e.created_at)}</td>
                        <td className="whitespace-nowrap py-2 pr-3">{rotuloDoTipo(tipoDoEvento(e.payload))}</td>
                        <td className="py-2 pr-3"><StatusChip label={sit} tone={TOM[sit]} /></td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {detalheDoEvento(e.payload)}
                          {e.erro && <div className="mt-1 font-mono text-destructive">⚠ {e.erro}</div>}
                          {aberto === e.id && (
                            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] text-foreground">
                              {JSON.stringify(e.payload, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">Clique numa linha para ver o conteúdo completo enviado pelo Z-API.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Linha({ ok, txt }: { ok: boolean | null; txt: string }) {
  const Icone = ok === null ? CircleDashed : ok ? CheckCircle2 : XCircle;
  const cor = ok === null ? "text-muted-foreground" : ok ? "text-[color:var(--bex-lime)]" : "text-destructive";
  return (
    <div className="flex items-start gap-1.5">
      <Icone className={`mt-px h-3.5 w-3.5 shrink-0 ${cor}`} />
      <span className="text-foreground">{txt}</span>
    </div>
  );
}
