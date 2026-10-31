import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, FileImage, FileText, Lock, Pause, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { etapaDe, fluxoParaEscolher, rotuloDe } from "@/domain/os/etapas";
import { areaEmTexto, descreverItem, resumoDaProducao } from "@/domain/os/o-que-produzir";
import { formatarData, paradaHa, prazoEmPalavras } from "@/domain/os/prazo";
import { arquivosEmOrdem, ehImagemVisivel, ehPdf, extensao, type ArquivoDaOs } from "@/domain/os/arquivos-da-os";
import { ROTULO_DA_FINALIDADE, type FinalidadeDaOS } from "@/domain/os/finalidade";
import { urlsAssinadas } from "@/lib/urls-dos-arquivos";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { AceiteDaArteRapido } from "@/components/kanban/aceite-da-arte-rapido";
import { AnexarArquivoRapido } from "@/components/kanban/anexar-arquivo-rapido";
import { MarcarComoFinal } from "@/components/kanban/marcar-como-final";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { TrilhaDaOs } from "@/components/kanban/trilha-da-os";
import { identidadeDaMaquina } from "@/domain/producao/identidade-da-maquina";
import { cn } from "@/lib/utils";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * A ficha da OS — o que o cartão abre.
 *
 * Redesenhada em 23/10/2026 a pedido do dono: era um painel lateral estreito, com
 * a lista de pendências em amarelo no meio e a arte em lugar nenhum. Agora é uma
 * janela grande, com a ARTE à esquerda — o arquivo que vai ser impresso, com os
 * outros arquivos da OS ao lado — e, à direita, onde a OS está (as seis etapas),
 * o que falta para produzir, o que vai ser produzido e o combinado.
 *
 * Enxugada em 31/10/2026, depois do teste do dono no quadro. O que mudou, e por quê:
 *
 *  - "O que falta" mostra só o que FALTA, cada pendência com o botão que a resolve
 *    (o cliente aprovou, marcar como final, anexar, abrir a OS). O que já está certo
 *    vira uma linha. Antes eram seis caixas, três delas com "✓", e o "como resolver"
 *    era só texto: quem lia sabia o que fazer e não tinha por onde.
 *  - Sem frase de explicação técnica ("as mesmas regras que o banco aplica...").
 *  - Equipe: o que falta definir vira uma frase só, em vez de três linhas vazias.
 *  - O seletor de etapa não oferece o status legado "Produção" (ver `fluxoParaEscolher`)
 *    e troca o "!" sem explicação por duas ou três palavras.
 *  - Escolher "Arte aprovada" sem o aceite abre o registro do aceite: o status sozinho
 *    não libera a produção, e a ficha não deixa a pessoa descobrir isso depois.
 *  - O botão de anexar só aparece para quem pode: a ficha oferecia a todos e o banco
 *    recusava ("sem permissão").
 */

/** As condições que o banco confere para a OS entrar em produção (os_bloqueios_para). */
const CONDICOES: { codigo: string; rotulo: string; soVenda?: boolean }[] = [
  { codigo: "sem_pagamento", rotulo: "Entrada paga", soVenda: true },
  { codigo: "arte_nao_aprovada", rotulo: "Arte aprovada pelo cliente", soVenda: true },
  { codigo: "sem_arquivo_final", rotulo: "Arquivo final de produção" },
  { codigo: "material_insuficiente", rotulo: "Material no estoque" },
  { codigo: "sem_responsavel", rotulo: "Responsável definido" },
  { codigo: "margem_baixa", rotulo: "Margem dentro do mínimo", soVenda: true },
];

/** "designer, operador e máquina". */
function emFrase(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function FichaDaOs({
  os,
  bloqueios = [],
  canSeePrices,
  aberto,
  onFechar,
  onMudarStatus,
  podeAnexar = false,
  podeFinalizar = false,
  podeAceitar = false,
}: {
  os: any | null;
  bloqueios?: BloqueioOs[];
  /** Vê preço de venda. A ficha só mostra valor — nunca custo nem margem. */
  canSeePrices?: boolean;
  aberto: boolean;
  onFechar: () => void;
  onMudarStatus: (osId: string, novoStatus: string) => void;
  /** arquivos.upload: sem ele o botão de anexar não é oferecido. */
  podeAnexar?: boolean;
  /** arquivos.finalize: marcar o arquivo como final de produção. */
  podeFinalizar?: boolean;
  /** os.update: registrar o aceite da arte do cliente. */
  podeAceitar?: boolean;
}) {
  const [escolhido, setEscolhido] = useState(0);
  const [aceiteAberto, setAceiteAberto] = useState(false);
  const arquivos = arquivosEmOrdem(os?.arquivos as ArquivoDaOs[] | undefined);

  // Outra OS aberta começa na primeira arte, com o registro do aceite fechado.
  useEffect(() => {
    setEscolhido(0);
    setAceiteAberto(false);
  }, [os?.id]);

  const urls = useQuery({
    queryKey: ["ficha-os-arquivos", os?.id, arquivos.map((a) => a.id).join(",")],
    enabled: aberto && arquivos.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => urlsAssinadas(arquivos.map((a) => a.caminho), 900),
  });

  if (!os) return null;

  const etapaAtual = etapaDe(os.status);
  const prazo = prazoEmPalavras(os.prazo_entrega);
  const producao = resumoDaProducao(os.itens);
  const parada = paradaHa(os.ultimo_movimento?.mudou_em ?? os.updated_at);
  const foraDoFluxo = etapaAtual === "fora_do_fluxo";
  const maquina = identidadeDaMaquina(os);
  const interna = os.finalidade && os.finalidade !== "venda";
  const falta = new Map(bloqueios.map((b) => [b.codigo, b]));
  const condicoes = CONDICOES.filter((c) => !(interna && c.soVenda));
  const pendencias = condicoes.filter((c) => falta.has(c.codigo));
  const pendentes = pendencias.length;
  const certas = condicoes.filter((c) => !falta.has(c.codigo));
  // Pendência que o banco devolve e esta lista não conhece: aparece mesmo assim.
  const desconhecidas = bloqueios.filter((b) => !CONDICOES.some((c) => c.codigo === b.codigo));
  const arquivo = arquivos[Math.min(escolhido, Math.max(arquivos.length - 1, 0))] ?? null;
  // Tudo certo e ainda antes da fila: o próximo passo é um toque.
  const podeIrParaAFila =
    pendentes === 0 && desconhecidas.length === 0 && (etapaAtual === "entrada" || etapaAtual === "pre_impressao");

  const equipe: [string, string | null][] = [
    ["Responsável", os.responsavel?.nome ?? null],
    ["Designer", os.designer?.nome ?? null],
    ["Operador", os.operador?.nome ?? null],
    ["Máquina", os.maquinas?.nome ?? (maquina ? `${maquina.curto} (não vinculada)` : null)],
  ];
  const definidos = equipe.filter(([, v]) => !!v);
  const semDefinir = equipe.filter(([, v]) => !v).map(([r]) => r.toLowerCase());

  function escolherEtapa(novo: string) {
    // "Arte aprovada" só pelo status não libera a produção: a trava lê o aceite. Pede o aceite.
    if (novo === "arte_aprovada" && falta.has("arte_nao_aprovada") && podeAceitar) {
      setAceiteAberto(true);
      toast.info("Para marcar “Arte aprovada”, registre o aceite do cliente.");
      return;
    }
    onMudarStatus(os.id, novo);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-5xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">OS #{os.numero}</span>
            {interna && <Badge variant="outline">{ROTULO_DA_FINALIDADE[os.finalidade as FinalidadeDaOS] ?? os.finalidade}</Badge>}
            {prazo && (
              <StatusChip label={prazo.texto} tone={prazo.tom === "magenta" ? "magenta" : prazo.tom === "amber" ? "amber" : "muted"} />
            )}
            {os.status === "pausado" && <StatusChip label="Pausada" tone="muted" />}
          </div>
          <DialogTitle className="text-xl leading-tight">{os.titulo}</DialogTitle>
          <DialogDescription>
            {interna ? (os.local_mostruario ?? "Trabalho interno") : (os.cliente_nome ?? "Sem cliente vinculado")}
            {canSeePrices && Number(os.valor_total) > 0 && (
              <span className="ml-2 font-mono text-[color:var(--bex-lime)]">{brl(Number(os.valor_total))}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(92dvh-6.5rem)] overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* ───── A arte: o que vai ser impresso ───── */}
          <section aria-label="Arte da OS" className="space-y-3 border-b border-border p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Arte · o que vai ser impresso
            </h3>
            {arquivo ? (
              <>
                <Visualizador arquivo={arquivo} url={urls.data?.get(arquivo.caminho) ?? null} carregando={urls.isPending} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{arquivo.nome}</div>
                    <div className="text-muted-foreground">
                      {arquivo.final_producao ? (
                        <span className="text-[color:var(--bex-lime)]">Arquivo final de produção</span>
                      ) : (
                        "Ainda não marcado como final de produção"
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {podeAnexar && <AnexarArquivoRapido osId={os.id} semArquivoFinal={!arquivos.some((a) => a.final_producao)} />}
                    {urls.data?.get(arquivo.caminho) && (
                      <Button asChild variant="outline" size="sm">
                        <a href={urls.data.get(arquivo.caminho)} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                {arquivos.length > 1 && (
                  <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Arquivos da OS">
                    {arquivos.map((a, i) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setEscolhido(i)}
                          aria-pressed={i === escolhido}
                          className={cn(
                            "relative h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted/50 text-[10px] text-muted-foreground",
                            i === escolhido ? "border-[color:var(--bex-cyan)] ring-1 ring-[color:var(--bex-cyan)]" : "border-border hover:border-foreground/30",
                          )}
                        >
                          {ehImagemVisivel(a.nome, a.mime_type, a.caminho) && urls.data?.get(a.caminho) ? (
                            <img src={urls.data.get(a.caminho)} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <span className="flex h-full w-full flex-col items-center justify-center gap-0.5">
                              <FileText className="h-4 w-4" aria-hidden />
                              <span className="font-semibold uppercase">{extensao(a.nome) || "arq"}</span>
                            </span>
                          )}
                          {a.final_producao && (
                            <span className="absolute left-1 top-1 rounded bg-[color:var(--bex-lime)] px-1 text-[9px] font-semibold text-black">final</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
                <FileImage className="h-8 w-8 text-muted-foreground/60" aria-hidden />
                <p className="text-sm font-medium text-foreground">Esta OS ainda não tem arquivo</p>
                {podeAnexar ? (
                  <>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      Anexe aqui: o arquivo já fica marcado como final de produção.
                    </p>
                    <AnexarArquivoRapido osId={os.id} semArquivoFinal />
                  </>
                ) : (
                  <p className="max-w-xs text-xs text-muted-foreground">Peça a quem pode anexar o arquivo da arte.</p>
                )}
              </div>
            )}
          </section>

          {/* ───── O resto: onde está, o que falta, o que produzir ───── */}
          <section aria-label="Situação da OS" className="space-y-5 p-5 lg:overflow-y-auto">
            <Bloco titulo="Onde está">
              {foraDoFluxo ? (
                <div className="flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  {/* Pausada não está no começo do caminho, está FORA dele. */}
                  <span>{rotuloDe(os.status)} — fora do fluxo. Não conta como fila até voltar a andar.</span>
                </div>
              ) : (
                <>
                  <TrilhaDaOs status={os.status} />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{rotuloDe(os.status)}</span>
                    {maquina && <SeloDaMaquina identidade={maquina} />}
                    {parada && <span className="font-mono">· parada há {parada}</span>}
                  </div>
                </>
              )}
            </Bloco>

            <Bloco titulo={pendentes > 0 ? `Para produzir · falta ${pendentes} de ${condicoes.length}` : "Para produzir · tudo certo"}>
              {(pendentes > 0 || desconhecidas.length > 0) && (
                <ul className="space-y-2">
                  {pendencias.map((c) => {
                    const b = falta.get(c.codigo)!;
                    return (
                      <li key={c.codigo} className="rounded-md border border-[color:var(--bex-amber)]/30 bg-[color:var(--bex-amber)]/10 px-3 py-2">
                        <div className="flex items-start gap-1.5 text-xs font-medium text-[color:var(--bex-amber)]">
                          <X className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span>{b.titulo}</span>
                          <span className="sr-only"> — pendente</span>
                        </div>
                        <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{b.resolver}</div>
                        <div className="mt-2 pl-5">
                          <AcaoDaPendencia
                            codigo={c.codigo}
                            osId={os.id}
                            arquivo={arquivo}
                            temArquivos={arquivos.length > 0}
                            podeAnexar={podeAnexar}
                            podeFinalizar={podeFinalizar}
                            podeAceitar={podeAceitar}
                            aceiteAberto={aceiteAberto}
                            onAceiteAberto={setAceiteAberto}
                            onFechar={onFechar}
                          />
                        </div>
                      </li>
                    );
                  })}
                  {desconhecidas.map((b) => (
                    <li key={b.codigo} className="rounded-md border border-[color:var(--bex-amber)]/30 bg-[color:var(--bex-amber)]/10 px-3 py-2">
                      <div className="flex items-start gap-1.5 text-xs font-medium text-[color:var(--bex-amber)]">
                        <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                        {b.titulo}
                      </div>
                      <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{b.resolver}</div>
                    </li>
                  ))}
                </ul>
              )}
              {certas.length > 0 && (
                <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", pendentes > 0 && "mt-2")}>
                  <Check className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--bex-lime)]" aria-hidden />
                  <span>
                    <span className="sr-only">Já está certo: </span>
                    {certas.map((c) => c.rotulo).join(" · ")}
                  </span>
                </p>
              )}
              {podeIrParaAFila && (
                <Button type="button" className="mt-3 w-full" onClick={() => onMudarStatus(os.id, "aguardando_producao")}>
                  Enviar para a fila de produção
                </Button>
              )}
            </Bloco>

            <Bloco titulo="O que vai ser produzido">
              {producao ? (
                <>
                  <ul className="space-y-1.5">
                    {(os.itens as any[]).map((item, i) => (
                      <li
                        key={item.id ?? i}
                        className="flex items-start justify-between gap-2 rounded border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        <span className="text-foreground/85">{descreverItem(item)}</span>
                        {canSeePrices && Number(item.valor_total) > 0 && (
                          <span className="shrink-0 font-mono text-muted-foreground">{brl(Number(item.valor_total))}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {areaEmTexto(producao.areaTotal) && (
                    <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">Metragem total: {areaEmTexto(producao.areaTotal)}</div>
                  )}
                </>
              ) : (
                <p className="rounded border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                  Nenhum item cadastrado nesta OS. Sem item, a produção não sabe o que fazer nem o estoque o que baixar.
                </p>
              )}
            </Bloco>

            <Bloco titulo="Combinado e equipe">
              <div className="space-y-1 text-xs">
                <p>
                  <span className="text-muted-foreground">Entrega </span>
                  <span className="font-medium text-foreground/85">{formatarData(os.prazo_entrega)}</span>
                  <span className="text-muted-foreground"> · Prioridade </span>
                  <span className="font-medium text-foreground/85">{PRIORIDADE[os.prioridade] ?? "—"}</span>
                </p>
                {definidos.length > 0 && (
                  <p className="text-muted-foreground">
                    {definidos.map(([rotulo, valor], i) => (
                      <span key={rotulo}>
                        {i > 0 && " · "}
                        {rotulo} <span className="font-medium text-foreground/85">{valor}</span>
                      </span>
                    ))}
                  </p>
                )}
                {semDefinir.length > 0 && <p className="text-muted-foreground">Ainda sem {emFrase(semDefinir)}.</p>}
              </div>
              {os.briefing && (
                <div className="mt-3 rounded border border-border/60 bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">{os.briefing}</div>
              )}
            </Bloco>

            <Bloco titulo="Mover para">
              <Select value={os.status} onValueChange={escolherEtapa}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fluxoParaEscolher(os.status).map((et) => (
                    <SelectGroup key={et.etapa}>
                      <SelectLabel className="text-[10px] uppercase tracking-wider">{et.rotulo}</SelectLabel>
                      {et.status.map((s) => (
                        <SelectItem key={s.status} value={s.status}>
                          {s.rotulo}
                          {s.dica && <span className="ml-1.5 text-[10px] text-muted-foreground">{s.dica}</span>}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Também dá para arrastar o cartão.</p>
            </Bloco>

            <Link to="/os/$id" params={{ id: os.id }} className="block" onClick={onFechar}>
              <Button variant="outline" size="sm" className="w-full">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Abrir a OS completa
              </Button>
            </Link>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O botão que resolve cada pendência. Só oferece o que a pessoa pode fazer: quem não pode
 * lê a quem pedir, em vez de apertar e tomar "sem permissão".
 */
function AcaoDaPendencia({
  codigo,
  osId,
  arquivo,
  temArquivos,
  podeAnexar,
  podeFinalizar,
  podeAceitar,
  aceiteAberto,
  onAceiteAberto,
  onFechar,
}: {
  codigo: string;
  osId: string;
  arquivo: ArquivoDaOs | null;
  temArquivos: boolean;
  podeAnexar: boolean;
  podeFinalizar: boolean;
  podeAceitar: boolean;
  aceiteAberto: boolean;
  onAceiteAberto: (aberto: boolean) => void;
  onFechar: () => void;
}) {
  switch (codigo) {
    case "arte_nao_aprovada":
      return podeAceitar ? (
        <AceiteDaArteRapido osId={osId} aberto={aceiteAberto} onAbertoChange={onAceiteAberto} />
      ) : (
        <Pedir texto="Peça a quem pode registrar o aceite da arte." />
      );
    case "sem_arquivo_final":
      if (temArquivos && arquivo && podeFinalizar) return <MarcarComoFinal arquivoId={arquivo.id} nome={arquivo.nome} />;
      // Sem arquivo nenhum, o botão de anexar já está na área da arte: aqui só aponta, para não haver dois iguais.
      if (!temArquivos && podeAnexar) return <Pedir texto="Use o botão “Anexar arquivo” na área da arte." />;
      return <Pedir texto={temArquivos ? "Peça a quem pode marcar o arquivo como final." : "Peça a quem pode anexar o arquivo."} />;
    case "sem_pagamento":
      return <IrPara osId={osId} rotulo="Registrar na OS" onFechar={onFechar} />;
    case "sem_responsavel":
      return <IrPara osId={osId} rotulo="Definir na OS" onFechar={onFechar} />;
    case "material_insuficiente":
      return (
        <Button asChild variant="outline" size="sm">
          <Link to="/materiais" onClick={onFechar}>
            Ver estoque
          </Link>
        </Button>
      );
    default:
      return null;
  }
}

function Pedir({ texto }: { texto: string }) {
  return <p className="text-[11px] italic text-muted-foreground">{texto}</p>;
}

function IrPara({ osId, rotulo, onFechar }: { osId: string; rotulo: string; onFechar: () => void }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/os/$id" params={{ id: osId }} onClick={onFechar}>
        {rotulo}
      </Link>
    </Button>
  );
}

/** A arte em tamanho de conferência: imagem inteira (sem cortar) sobre fundo xadrez, para ver transparência. */
function Visualizador({ arquivo, url, carregando }: { arquivo: ArquivoDaOs; url: string | null; carregando: boolean }) {
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => setQuebrou(false), [arquivo.id]);
  const imagem = ehImagemVisivel(arquivo.nome, arquivo.mime_type, arquivo.caminho);
  return (
    <div
      className="flex aspect-[4/3] max-h-[52dvh] w-full items-center justify-center overflow-hidden rounded-lg border border-border"
      style={{
        backgroundColor: "var(--muted)",
        backgroundImage:
          "linear-gradient(45deg, rgba(128,128,128,.12) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.12) 75%), linear-gradient(45deg, rgba(128,128,128,.12) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.12) 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 8px 8px",
      }}
    >
      {imagem && url && !quebrou ? (
        <img src={url} alt={`Arte: ${arquivo.nome}`} className="h-full w-full object-contain" onError={() => setQuebrou(true)} />
      ) : (
        <div className="flex flex-col items-center gap-1.5 p-4 text-center text-muted-foreground">
          <FileText className="h-8 w-8" aria-hidden />
          <span className="text-sm font-semibold uppercase text-foreground">{ehPdf(arquivo.nome, arquivo.mime_type) ? "PDF" : extensao(arquivo.nome) || "Arquivo"}</span>
          <span className="max-w-[16rem] truncate text-xs">{arquivo.nome}</span>
          <span className="text-[11px]">
            {carregando && imagem
              ? "Carregando a imagem…"
              : imagem
                ? "Não foi possível mostrar a imagem agora."
                : "Este formato não abre aqui. Use “Abrir” para ver o arquivo."}
          </span>
        </div>
      )}
    </div>
  );
}

const PRIORIDADE: Record<number, string> = {
  1: "Urgente",
  2: "Alta",
  3: "Normal",
  4: "Baixa",
  5: "Mínima",
};

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}
