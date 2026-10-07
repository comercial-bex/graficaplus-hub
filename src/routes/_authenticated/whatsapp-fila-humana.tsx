import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Clock, Hand, Loader2, MessageCircle, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import {
  nomeDaConversa,
  resumoDaConversa,
  telefoneLegivel,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  ESPERA_ATENCAO_MIN,
  ESPERA_ATRASADA_MIN,
  SETORES,
  corDaEspera,
  esperaDe,
  infoDoSetor,
  ordenarPorEspera,
  setoresDoFiltro,
  type FiltroDeSetor,
} from "@/domain/whatsapp/filas";
import {
  CHAVES,
  mapaDeNomes,
  useEquipe,
  useFilaHumana,
  useMinhasFilas,
  useTempoRealDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { acaoNaConversa } from "@/lib/api/whatsapp-caixa.functions";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

export const Route = createFileRoute("/_authenticated/whatsapp-fila-humana")({
  head: () => ({ meta: [{ title: "Fila humana — BEX PRINT OS" }] }),
  component: FilaHumanaPage,
});

/**
 * Fila humana (caixa v3, 07/10/2026): as conversas abertas em que o CLIENTE
 * escreveu por último e ninguém respondeu — `whatsapp_conversas.aguardando_desde`,
 * que o gatilho preenche quando o cliente escreve e zera quando a equipe (ou a
 * assistente) responde. Também caem aqui as que a assistente passou para a
 * equipe. De quem espera há mais tempo para quem espera há menos.
 */
function FilaHumanaPage() {
  const { hasPermission, user } = useAuth();
  const podeResponder = hasPermission("whatsapp.reply");
  const qc = useQueryClient();
  const acao = useServerFn(acaoNaConversa);
  useTempoRealDaCaixa();
  const minhasFilas = useMinhasFilas();
  const equipe = useEquipe();
  const nomes = mapaDeNomes(equipe.data);
  const [setor, setSetor] = useState<FiltroDeSetor>("todas");
  const [assumindo, setAssumindo] = useState<string | null>(null);
  const setores = setoresDoFiltro(setor, minhasFilas.isError ? null : minhasFilas.data);
  const fila = useFilaHumana(setores);
  const lista = ordenarPorEspera(fila.data ?? []);
  const atrasadas = lista.filter((c) => (esperaDe(c.aguardando_desde)?.nivel ?? "ok") === "atrasada").length;

  async function assumir(conversaId: string) {
    setAssumindo(conversaId);
    try {
      await acao({ data: { acao: "assumir", conversaId } });
      toast.success("Você assumiu o atendimento. Responda pela caixa de entrada.");
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setAssumindo(null);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/whatsapp-fila-humana")}
        breadcrumb="Atendimento · WhatsApp"
        title="Fila humana"
        description={`Clientes esperando resposta. Âmbar passa de ${ESPERA_ATENCAO_MIN} min; vermelho, de ${ESPERA_ATRASADA_MIN / 60} h.`}
        className="mb-2"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/whatsapp" aria-label="Abrir a caixa de entrada">
              <MessageCircle className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Caixa de entrada</span>
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filas por setor">
        {(["todas", "minhas_filas"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={setor === v}
            onClick={() => setSetor(v)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              setor === v ? "border-foreground/30 bg-foreground/10 font-semibold" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {v === "todas" ? "Todas as filas" : "Minhas filas"}
          </button>
        ))}
        {SETORES.map((s) => (
          <button
            key={s.valor}
            type="button"
            aria-pressed={setor === s.valor}
            onClick={() => setSetor(s.valor)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs",
              setor === s.valor ? cn(s.cor, "font-semibold") : "text-muted-foreground hover:bg-muted",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", s.ponto)} aria-hidden />
            {s.rotulo}
          </button>
        ))}
        {!fila.isPending && !fila.isError && (
          <span className="ml-auto text-xs text-muted-foreground">
            {lista.length} esperando{atrasadas > 0 && <> · <strong className="text-destructive">{atrasadas} há mais de 1 h</strong></>}
          </span>
        )}
      </div>

      {fila.isError ? (
        <FalhaDeConsulta
          titulo="Não foi possível carregar a fila humana"
          erro={fila.error}
          onTentarDeNovo={() => void fila.refetch()}
        />
      ) : fila.isPending ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : lista.length === 0 ? (
        <Card className="mx-auto max-w-xl space-y-2 p-8 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Ninguém esperando — tudo em dia</h2>
          <p className="text-sm text-muted-foreground">
            Quando um cliente escrever e ficar sem resposta, ele aparece aqui, de quem espera há mais tempo
            para quem espera há menos.
          </p>
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {lista.map((c) => {
            const espera = esperaDe(c.aguardando_desde);
            const setorDaConversa = infoDoSetor(c.fila);
            const responsavel = c.responsavel_id ? (nomes.get(c.responsavel_id) ?? "Equipe") : null;
            const veioDaIa = c.modo === "humano" && !c.responsavel_id;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
                <div
                  className={cn(
                    "flex w-20 shrink-0 items-center gap-1 text-sm font-semibold",
                    espera ? corDaEspera(espera.nivel) : "text-muted-foreground",
                  )}
                  title="Tempo que o cliente espera resposta"
                >
                  <Clock className="h-4 w-4" aria-hidden />
                  {espera?.texto ?? "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{nomeDaConversa(c)}</span>
                    <span className={cn("rounded border px-1.5 py-0.5 text-[10px]", setorDaConversa.cor)}>
                      {setorDaConversa.rotulo}
                    </span>
                    {veioDaIa && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Bot className="h-3 w-3" /> passada pela assistente
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{resumoDaConversa(c.ultima_mensagem)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {telefoneLegivel(c.telefone)} · {responsavel ? `com ${responsavel}` : "sem responsável"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {podeResponder && c.responsavel_id !== user?.id && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={assumindo === c.id}
                      onClick={() => void assumir(c.id)}
                    >
                      {assumindo === c.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Hand className="mr-1 h-4 w-4" />
                      )}
                      Assumir
                    </Button>
                  )}
                  <Button asChild size="sm">
                    <Link to="/whatsapp" search={{ conversa: c.id }}>
                      Abrir
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
