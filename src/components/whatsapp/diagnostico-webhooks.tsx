/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: whatsapp_medidas_de_entrada não está nos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  CircleDashed,
  FileWarning,
  Gauge,
  History,
  RefreshCw,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import {
  ROTULO_SITUACAO,
  detalheDoEvento,
  estadoDosWebhooks,
  eventoTemMidia,
  lerMedidasDeEntrada,
  rotuloDoTipo,
  situacaoDoEvento,
  tipoDoEvento,
  WEBHOOKS,
  type EventoGravado,
  type SituacaoEvento,
} from "@/domain/whatsapp/diagnostico-webhooks";
import {
  verificarConexaoZapi,
  type ResultadoVerificacao,
} from "@/lib/api/whatsapp-verificar.functions";
import { reprocessarMidiaDoEvento } from "@/lib/api/whatsapp-midia.functions";

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR");
const TOM: Record<SituacaoEvento, "lime" | "magenta" | "cyan" | "amber"> = {
  processado: "lime",
  processado_com_falha: "amber",
  erro: "magenta",
  pendente: "cyan",
};
const TEMPO_TESTE_MS = 90_000;

export function DiagnosticoWebhooks() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // Mandar mensagem de teste pelo número da gráfica e reprocessar mídia é de
  // quem administra a conexão. O servidor confere de novo (has_permission).
  const podeGerenciar = hasPermission("whatsapp.manage");
  const verificar = useServerFn(verificarConexaoZapi);
  const reprocessar = useServerFn(reprocessarMidiaDoEvento);
  const [resultado, setResultado] = useState<ResultadoVerificacao | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroSit, setFiltroSit] = useState("todos");
  const [aberto, setAberto] = useState<string | null>(null);

  const consulta = useQuery({
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
  const eventos = useMemo(() => consulta.data ?? [], [consulta.data]);
  const isLoading = consulta.isPending;

  useEffect(() => {
    if (!aguardando) return;
    const t = setTimeout(() => setAguardando(false), TEMPO_TESTE_MS);
    return () => clearTimeout(t);
  }, [aguardando]);

  const estados = useMemo(
    () => estadoDosWebhooks(eventos, resultado?.inicio),
    [eventos, resultado],
  );

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

  async function reprocessarMidia(eventoId: string) {
    setReprocessando(eventoId);
    try {
      const r = await reprocessar({ data: { eventoId } });
      if (r.ok) {
        toast.success(
          r.reaproveitada
            ? "Mídia ligada à mensagem: a cópia que já estava no armazenamento foi reaproveitada."
            : "Mídia copiada e ligada à mensagem.",
        );
      } else {
        toast.error(`Não deu para reprocessar: ${r.erro}`);
      }
      qc.invalidateQueries({ queryKey: ["whatsapp-webhook-eventos"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-medidas-de-entrada"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setReprocessando(null);
    }
  }

  function veredito(w: (typeof estados)[number]) {
    if (consulta.isError)
      return { tom: "magenta" as const, txt: "Não deu para conferir (a leitura falhou)" };
    if (w.noTeste) return { tom: "lime" as const, txt: "Funcionando (chegou no teste)" };
    if (aguardando && (w.chave === "receber" || w.chave === "status"))
      return { tom: "cyan" as const, txt: "Aguardando o teste…" };
    if (resultado?.testeEnviado && !aguardando && w.chave === "status")
      return { tom: "magenta" as const, txt: "Não chegou — confira este campo no Z-API" };
    if (w.erros > 0 && w.erros === w.total)
      return { tom: "magenta" as const, txt: "Chega, mas falha ao processar" };
    if (w.ultimo) return { tom: "lime" as const, txt: "Já recebeu eventos" };
    if (w.chave === "conectar" || w.chave === "desconectar")
      return { tom: "muted" as const, txt: "Só dispara ao conectar/desconectar o celular" };
    return { tom: "amber" as const, txt: "Nunca recebeu — cole o endereço neste campo" };
  }

  return (
    <>
      <MedidasDeEntrada />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" /> Verificação de conexão
          </CardTitle>
          {podeGerenciar && (
            <Button size="sm" onClick={rodar} disabled={verificando || aguardando}>
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              {verificando
                ? "Verificando…"
                : aguardando
                  ? "Aguardando eventos…"
                  : "Verificar agora"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Pergunta ao Z-API se a instância está conectada e manda uma mensagem de teste para o
            próprio número da empresa. Em até 90 segundos mostramos quais webhooks responderam.
            {!podeGerenciar &&
              " Rodar a verificação é de quem administra o WhatsApp (whatsapp › manage)."}
          </p>
          {consulta.isError && (
            <FalhaDeConsulta
              titulo="Não foi possível ler os eventos do webhook"
              erro={consulta.error}
              onTentarDeNovo={() => void consulta.refetch()}
            />
          )}
          {resultado && (
            <div className="grid gap-2 rounded border border-border/60 bg-muted/30 p-3 text-xs md:grid-cols-2">
              <Linha
                ok={resultado.credenciais}
                txt={
                  resultado.credenciais
                    ? "Token do Z-API configurado"
                    : "Token do Z-API ausente no servidor"
                }
              />
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
              {resultado.celularConectado === false && (
                <Linha ok={false} txt="O celular está sem internet" />
              )}
              <Linha
                ok={resultado.testeEnviado ? true : resultado.erroTeste ? false : null}
                txt={
                  resultado.testeEnviado
                    ? "Mensagem de teste enviada"
                    : (resultado.erroTeste ?? "Teste não enviado")
                }
              />
            </div>
          )}
          <div className="divide-y divide-border/60 rounded border border-border/60">
            {estados.map((w) => {
              const v = veredito(w);
              return (
                <div
                  key={w.chave}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5"
                >
                  <div>
                    <div className="font-medium text-foreground">{w.rotulo}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {consulta.isError
                        ? "sem leitura"
                        : w.ultimo
                          ? `último: ${fmt(w.ultimo)} · ${w.total} evento(s)`
                          : "nenhum evento"}
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
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {WEBHOOKS.map((w) => (
                  <SelectItem key={w.tipo} value={w.tipo}>
                    {rotuloDoTipo(w.tipo)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroSit} onValueChange={setFiltroSit}>
              <SelectTrigger className="h-8 w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as situações</SelectItem>
                {(Object.keys(ROTULO_SITUACAO) as SituacaoEvento[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ROTULO_SITUACAO[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {consulta.isError ? (
            <FalhaDeConsulta
              titulo="Não foi possível carregar o histórico"
              erro={consulta.error}
              onTentarDeNovo={() => void consulta.refetch()}
            />
          ) : isLoading ? (
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
                    const podeReprocessar =
                      podeGerenciar && sit === "processado_com_falha" && eventoTemMidia(e.payload);
                    return (
                      <tr
                        key={e.id}
                        className="cursor-pointer border-b border-border/40 align-top hover:bg-muted/30"
                        onClick={() => setAberto(aberto === e.id ? null : e.id)}
                      >
                        <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">
                          {fmt(e.created_at)}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          {rotuloDoTipo(tipoDoEvento(e.payload))}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusChip label={ROTULO_SITUACAO[sit]} tone={TOM[sit]} />
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {detalheDoEvento(e.payload)}
                          {e.erro && (
                            <div className="mt-1 font-mono text-destructive">⚠ {e.erro}</div>
                          )}
                          {podeReprocessar && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 text-xs"
                              disabled={reprocessando === e.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void reprocessarMidia(e.id);
                              }}
                            >
                              <RefreshCw
                                className={`mr-1 h-3 w-3 ${reprocessando === e.id ? "animate-spin" : ""}`}
                              />
                              Reprocessar mídia
                            </Button>
                          )}
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
              <p className="mt-2 text-[11px] text-muted-foreground">
                Clique numa linha para ver o conteúdo completo enviado pelo Z-API.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * As duas medidas permanentes da entrada. Os números certos são ZERO; qualquer
 * coisa acima é mensagem de cliente que o sistema deve e não tem. Em
 * 06/10/2026 eram 1 e 1. Lidas por função do banco (`whatsapp_medidas_de_entrada`):
 * a conta cruza recibos com eventos e o PostgREST corta leituras em 1.000
 * linhas — contar no navegador mentiria quando o histórico crescesse.
 */
function MedidasDeEntrada() {
  const medidas = useQuery({
    queryKey: ["whatsapp-medidas-de-entrada"],
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("whatsapp_medidas_de_entrada");
      if (error) throw error;
      return lerMedidasDeEntrada(data);
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> O que a entrada está devendo
        </CardTitle>
        {medidas.isSuccess && (
          <span className="font-mono text-[11px] text-muted-foreground">
            medido {fmt(medidas.data.medido_em)}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {medidas.isError ? (
          <FalhaDeConsulta
            titulo="Não foi possível medir a entrada"
            erro={medidas.error}
            onTentarDeNovo={() => void medidas.refetch()}
          />
        ) : medidas.isPending ? (
          <p className="text-xs text-muted-foreground">Medindo…</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Medida
              valor={medidas.data.recibos_sem_mensagem}
              titulo="Recibos sem mensagem"
              detalhe="A empresa leu no celular (READ_BY_ME), mas a mensagem nunca chegou ao sistema. Cada uma aqui é um cliente que escreveu e ninguém viu na caixa de entrada."
              icone={<FileWarning className="h-4 w-4" />}
            />
            <Medida
              valor={medidas.data.midias_sem_copia}
              titulo="Mídia recebida sem cópia"
              detalhe="Foto, PDF ou áudio que só existe no link do Z-API, que vence em 30 dias. Reprocesse pelo histórico abaixo."
              icone={<FileWarning className="h-4 w-4" />}
            />
            {medidas.data.recibos.length > 0 && (
              <ul className="font-mono text-[11px] text-muted-foreground md:col-span-2">
                {medidas.data.recibos.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    {r.momento ? fmt(r.momento) : "sem horário"} · {r.telefone ?? "sem telefone"} ·{" "}
                    {r.id}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Medida({
  valor,
  titulo,
  detalhe,
  icone,
}: {
  valor: number;
  titulo: string;
  detalhe: string;
  icone: React.ReactNode;
}) {
  const ok = valor === 0;
  return (
    <div
      className={`rounded border p-3 ${ok ? "border-border/60 bg-muted/30" : "border-destructive/50 bg-destructive/10"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          {icone} {titulo}
        </div>
        <span
          className={`font-mono text-2xl font-bold ${ok ? "text-[color:var(--bex-lime)]" : "text-destructive"}`}
        >
          {valor}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function Linha({ ok, txt }: { ok: boolean | null; txt: string }) {
  const Icone = ok === null ? CircleDashed : ok ? CheckCircle2 : XCircle;
  const cor =
    ok === null
      ? "text-muted-foreground"
      : ok
        ? "text-[color:var(--bex-lime)]"
        : "text-destructive";
  return (
    <div className="flex items-start gap-1.5">
      <Icone className={`mt-px h-3.5 w-3.5 shrink-0 ${cor}`} />
      <span className="text-foreground">{txt}</span>
    </div>
  );
}
