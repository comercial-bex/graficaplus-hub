import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { IconeDaMaquina, SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  avisoDeComecou,
  avisoDeTerminou,
  caraDaMaquina,
  erroDeMaquina,
  ondeEstaRodando,
  precisaAcertarStatus,
  situacaoDoBotao,
  type ApontamentoAberto,
  type ComecouNaMaquina,
  type ErroDeMaquina,
  type MaquinaParaComecar,
  type MaquinasParaComecar,
  type TerminouSoEstaMaquina,
} from "@/domain/os/comecar-na-maquina";

/**
 * "Em qual máquina?" — os botões grandes do Começar.
 *
 * Quem usa está na frente da máquina, com o celular numa mão e a outra suja de
 * tinta. Por isso: uma lista de botões da largura da tela, um por máquina, na
 * MESMA ordem das colunas da TV da Oficina (a ordem não muda conforme a OS —
 * o dedo aprende onde cada uma fica). Um toque começa; não há "confirmar".
 * Engano se desfaz com "Terminei".
 *
 * CADA MÁQUINA ABERTA TEM O SEU "TERMINEI". A primeira versão tinha um botão
 * só, que fechava tudo o que a OS tinha aberto: com a peça na impressão e no
 * recorte, não havia como liberar a impressão sem fechar também o recorte, que
 * ainda estava rodando. A máquina parada seguia contando tempo — e custo — e
 * ocupada para a próxima OS da fila.
 *
 * A sugerida vem destacada, mas não vem pré-escolhida: o produto diz a máquina
 * padrão, e quem sabe onde a peça vai rodar de fato é quem está na oficina.
 *
 * A ocupada fica desabilitada dizendo COM O QUÊ e desde quando ("OS #90 desde
 * 14:32") — "ocupada" sozinho não ajuda ninguém a decidir se espera.
 *
 * Sem dinheiro. O seletor antigo (apontamento-card) escrevia o R$/h de cada
 * máquina para quem aponta; aqui a resposta do banco nem traz custo.
 */
export function SeletorDeMaquina({
  os,
  abertos,
  onFechar,
}: {
  /** A OS que vai começar. `null` = fechado. */
  os: { id: string; numero: number | null; titulo: string | null } | null;
  /** Os apontamentos que ESTA OS já tem abertos (para "Outra máquina"). */
  abertos: ApontamentoAberto[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { hasPermission, canSeeFinancials, canSeePrices } = useAuth();
  const podeFinalizar = hasPermission("producao.finish");
  const visao = { canSeeFinancials, canSeePrices };

  /** id da máquina tocada, enquanto o banco responde */
  const [comecando, setComecando] = useState<string | null>(null);
  /** id do apontamento que está sendo fechado */
  const [terminando, setTerminando] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroDeMaquina | null>(null);
  const ocupado = comecando !== null || terminando !== null;

  // A folha leva 300 ms para descer depois que `os` vira null; sem guardar a
  // última, o título piscaria "OS #—" a cada toque.
  const [ultima, setUltima] = useState(os);
  if (os && os !== ultima) setUltima(os);
  const alvo = os ?? ultima;

  const osId = os?.id ?? null;
  // O erro é da OS que estava aberta: trocar de OS começa limpo.
  useEffect(() => setErro(null), [osId]);

  const lista = useQuery({
    // Dentro do prefixo do painel: quando qualquer passo invalida
    // ["painel-producao"], os botões são lidos de novo junto com a fila.
    queryKey: ["painel-producao", "maquinas-para-comecar", osId],
    enabled: osId !== null,
    // Máquina ocupa e desocupa a toda hora, e por outras mãos: nunca servir a
    // lista de uma abertura anterior.
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<MaquinasParaComecar> => {
      const { data, error } = await (supabase.rpc as any)("maquinas_para_comecar", {
        p_os_id: osId,
      });
      if (error) throw error;
      return data as MaquinasParaComecar;
    },
  });

  // Com `os` nulo a consulta fica desligada e sem dado — e a folha ainda leva
  // 300 ms para descer. Sem guardar a última lista, nesse intervalo a folha
  // escrevia "Nenhuma máquina ativa no cadastro" logo depois de um Começar que
  // deu certo: um vazio falso. Vale só para a MESMA OS; trocar de OS nunca
  // mostra os botões da anterior.
  const [ultimaLista, setUltimaLista] = useState<MaquinasParaComecar | null>(null);
  if (lista.data && lista.data !== ultimaLista) setUltimaLista(lista.data);
  const dados: MaquinasParaComecar | null =
    lista.data ?? (os === null && ultimaLista?.os_id === ultima?.id ? ultimaLista : null);

  async function comecar(m: MaquinaParaComecar) {
    if (!os || ocupado) return;
    setComecando(m.id);
    setErro(null);
    try {
      const { data, error } = await (supabase.rpc as any)("comecar_na_maquina", {
        p_os_id: os.id,
        p_maquina_id: m.id,
      });
      if (error) {
        const e = erroDeMaquina(error, visao);
        setErro(e);
        // Outra pessoa pegou a máquina entre a lista e o toque: os botões que
        // estão na tela já não valem.
        if (e.listaMudou) lista.refetch();
        return;
      }
      const aviso = avisoDeComecou(data as ComecouNaMaquina);
      toast.success(aviso.titulo, { description: aviso.descricao ?? undefined });
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
      onFechar();
    } catch (e) {
      setErro(erroDeMaquina(e, visao));
    } finally {
      setComecando(null);
    }
  }

  /**
   * Fecha o apontamento desta OS NAQUELA máquina — só ele — e NÃO muda o
   * status: é a peça que saiu da impressão e vai para o recorte. Sem isto a
   * primeira máquina ficaria "ocupada" até a OS ir para o acabamento, travando
   * a próxima da fila. `terminar_so_esta_maquina` não devolve custo.
   */
  async function terminar(linha: { id: string; maquina_id: string | null }) {
    if (!os || ocupado || !linha.maquina_id) return;
    setTerminando(linha.id);
    setErro(null);
    try {
      const { data, error } = await (supabase.rpc as any)("terminar_so_esta_maquina", {
        p_os_id: os.id,
        p_maquina_id: linha.maquina_id,
      });
      if (error) {
        setErro(erroDeMaquina(error, visao));
        return;
      }
      const aviso = avisoDeTerminou(data as TerminouSoEstaMaquina);
      toast.success(aviso.titulo, { description: aviso.descricao });
      // Fica aberto: o próximo toque costuma ser a máquina seguinte.
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    } catch (e) {
      setErro(erroDeMaquina(e, visao));
    } finally {
      setTerminando(null);
    }
  }

  const agora = new Date();
  const rodando = ondeEstaRodando(abertos, agora);
  const maquinas = dados?.maquinas ?? [];
  const falha = lista.isError ? erroDeMaquina(lista.error, visao) : null;
  // A OS foi apontada pela ficha e o status não acompanhou: a máquina em que
  // ela já roda fica tocável, para o status alcançar o apontamento.
  const acertar = dados ? precisaAcertarStatus(dados) : false;

  return (
    <Sheet open={os !== null} onOpenChange={(v) => !v && !ocupado && onFechar()}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-xl p-4 pb-6 sm:max-w-xl"
      >
        <SheetHeader className="space-y-1 pr-8 text-left">
          <SheetTitle className="text-xl leading-tight">
            OS #{alvo?.numero ?? "—"} — em qual máquina?
          </SheetTitle>
          <SheetDescription className="truncate">
            {alvo?.titulo || "Sem título"} · um toque começa a contar o tempo
          </SheetDescription>
        </SheetHeader>

        {rodando.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Rodando agora
            </p>
            <ul className="space-y-2">
              {rodando.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <SeloDaMaquina identidade={r.maquina} />
                    {r.desde && <span className="tabular-nums">desde {r.desde}</span>}
                  </span>
                  {podeFinalizar &&
                    (r.maquina_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 shrink-0 px-4 text-base"
                        disabled={ocupado}
                        aria-label={`Terminei: ${r.maquina.curto}`}
                        onClick={() => terminar(r)}
                      >
                        <Check className="mr-1 h-5 w-5" />
                        {terminando === r.id ? "Fechando..." : "Terminei"}
                      </Button>
                    ) : (
                      // Apontamento sem máquina (apagada do cadastro): não há
                      // o que mandar para a função; fecha-se pela ficha.
                      <span className="text-xs text-muted-foreground">
                        encerre pela ficha da OS
                      </span>
                    ))}
                </li>
              ))}
            </ul>
            {podeFinalizar && (
              <p className="text-xs text-muted-foreground">
                A peça saiu de uma máquina? Toque em <strong>Terminei</strong> nela antes de
                escolher a próxima — senão ela continua contando tempo e ocupada. A OS segue em
                produção; para ir ao acabamento, use o botão do cartão.
              </p>
            )}
          </div>
        )}

        {/* O erro fica escrito na folha, e não só num toast que some: quem está
            com a mão ocupada precisa conseguir ler depois. */}
        {erro && (
          <div
            role="alert"
            className="flex gap-2 rounded-lg border border-[color:var(--bex-magenta)]/50 bg-[color:var(--bex-magenta)]/10 p-3"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--bex-magenta)]" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-base font-semibold leading-snug">{erro.titulo}</p>
              {erro.descricao && <p className="text-sm leading-snug">{erro.descricao}</p>}
            </div>
          </div>
        )}

        {lista.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Carregando as máquinas...
          </p>
        ) : falha ? (
          // Falha NÃO é lista vazia: dizer "nenhuma máquina" aqui mandaria o
          // impressor procurar um cadastro que está certo.
          <div role="alert" className="space-y-3 rounded-lg border border-border p-4 text-center">
            <p className="text-base font-semibold">Não deu para carregar as máquinas</p>
            <p className="text-sm text-muted-foreground">{falha.descricao ?? falha.titulo}</p>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              disabled={lista.isFetching}
              onClick={() => lista.refetch()}
            >
              <RefreshCw className="mr-1 h-5 w-5" />
              {lista.isFetching ? "Tentando..." : "Tentar de novo"}
            </Button>
          </div>
        ) : !dados ? null : maquinas.length === 0 ? ( // sem resposta na mão não se afirma "nenhuma"
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma máquina ativa no cadastro. Avise o gestor.
          </p>
        ) : (
          <ul className="space-y-2">
            {maquinas.map((m) => {
              const cara = caraDaMaquina(m);
              const { habilitado, motivo, acerto } = situacaoDoBotao(
                m,
                dados.os_encerrada,
                agora,
                acertar,
              );
              const esta = comecando === m.id;
              // Sugerida e ocupada não é sugestão: o destaque só vale no botão
              // que dá para tocar.
              const destaque = m.sugerida && habilitado;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    // `!os`: a folha está descendo; os botões guardados não tocam.
                    disabled={!habilitado || ocupado || !os}
                    onClick={() => comecar(m)}
                    aria-label={motivo ? `${cara.curto} — ${motivo}` : `Começar: ${cara.curto}`}
                    className={cn(
                      "flex min-h-[76px] w-full items-center gap-3 rounded-xl border-2 bg-card p-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      habilitado
                        ? "active:bg-muted hover:bg-muted/60"
                        : "cursor-not-allowed border-dashed",
                      !destaque && "border-border",
                    )}
                    style={destaque ? { borderColor: cara.cor } : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border",
                        !habilitado && "opacity-40",
                      )}
                      style={{ borderColor: `${cara.cor}55`, backgroundColor: `${cara.cor}1a` }}
                    >
                      <IconeDaMaquina identidade={cara} className="h-8 w-8" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-xl font-semibold leading-tight",
                          !habilitado && "text-muted-foreground",
                        )}
                      >
                        {esta ? (acerto ? "Acertando..." : "Começando...") : cara.curto}
                      </span>
                      {/* O motivo NÃO esmaece junto com o botão: é o que há para ler. */}
                      {motivo ? (
                        <span className="mt-0.5 block text-sm font-medium leading-snug text-[color:var(--bex-amber)]">
                          {motivo}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {m.nome}
                        </span>
                      )}
                    </span>

                    {destaque && (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs font-semibold"
                        style={{ color: cara.cor, borderColor: `${cara.cor}55` }}
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden />
                        sugerida
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Button
          type="button"
          variant="ghost"
          className="h-12 w-full text-base"
          disabled={ocupado}
          onClick={onFechar}
        >
          Fechar
        </Button>
      </SheetContent>
    </Sheet>
  );
}
