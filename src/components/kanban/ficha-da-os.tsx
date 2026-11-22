import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, FileImage, FileText, Lock, Pause, Printer, X } from "lucide-react";
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
import {
  ehArquivoDeImpressao,
  ehImagemVisivel,
  ehMockup,
  ehPdf,
  conferirMedidaDoPdf,
  extensao,
  formatoDoArquivo,
  resolucaoNoTamanho,
  separarArquivos,
  textoDaResolucao,
  type ArquivoDaOs,
} from "@/domain/os/arquivos-da-os";
import { ROTULO_DA_FINALIDADE, type FinalidadeDaOS } from "@/domain/os/finalidade";
import { urlsParaVer } from "@/lib/baixar-arquivo";
import { medirPdf } from "@/lib/pdf/medir-pdf";
import { tamanhoLegivel } from "@/components/design/tipo-de-arquivo";
import { BotaoAbrir, BotaoBaixar } from "@/components/arquivos/botoes-do-arquivo";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { AceiteDaArteRapido } from "@/components/kanban/aceite-da-arte-rapido";
import { AnexarArquivoRapido } from "@/components/kanban/anexar-arquivo-rapido";
import { MarcarComoFinal } from "@/components/kanban/marcar-como-final";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { TrilhaDaOs } from "@/components/kanban/trilha-da-os";
import {
  AutorizacoesDaOs,
  AutorizarMargemBaixa,
  AutorizarSaldoDevedor,
  EscolherOperadorDialog,
  PedirAoGestor,
  TrocarOperador,
  ValidarAtendimento,
  ValidarAtendimentoDialog,
  useEquipeDaProducao,
  usePedidosAoGestor,
} from "@/components/kanban/aval-do-gestor";
import { MaquinaDaOs } from "@/components/kanban/maquina-da-os";
import { LinhaDoTempoDaOs } from "@/components/kanban/linha-do-tempo-da-os";
import { comQuem, quemFazAgora } from "@/domain/os/quem-faz-agora";
import { identidadeDaMaquina } from "@/domain/producao/identidade-da-maquina";
import { ehGestor, primeiroNome } from "@/domain/os/equipe-da-producao";
import { useAuth } from "@/lib/auth-context";
import { FichaDoTrofeuDaOs } from "@/components/trofeus/ficha-do-trofeu";
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
 *
 * Mockup × arquivo de impressão (14/11/2026, pedido do dono): a esquerda era um
 * bloco só, "Arte · o que vai ser impresso", com o mockup do orçamento ao lado do
 * PDF da máquina, e o "Abrir" só abria (CDR/AI/3MF o navegador nem mostra). Agora
 * são três partes, na ordem em que a produção precisa:
 *   1. ARQUIVO DE IMPRESSÃO — o que vai para a máquina, com "Baixar" de verdade
 *      (nome legível, qualquer formato, qualquer bucket). Versão antiga do mesmo
 *      arquivo fica recolhida, com aviso de não imprimir.
 *   2. MOCKUP — o visual que o cliente viu e aprovou, em tamanho de conferência,
 *      com a situação da aprovação.
 *   3. OUTROS ANEXOS — briefing, comprovante, o que veio pelo WhatsApp.
 * A regra de quem é o quê está em domain/os/arquivos-da-os (`separarArquivos`).
 *
 * O aval do gestor e quem faz (14/11/2026, pedido do dono):
 *   - Sair do Atendimento pede a validação do gestor: o gestor valida aqui mesmo,
 *     escolhendo quem faz a criação; quem não é gestor pede pelo grupo da equipe.
 *   - "Nenhum pagamento registrado" ganhou a saída do gestor: autorizar o cliente a
 *     ficar devendo, com o motivo.
 *   - "Enviar para a fila de produção" (e escolher a fila no seletor) abre a escolha
 *     do operador; na fila e na máquina dá para trocar o operador.
 * Os componentes estão em aval-do-gestor.tsx; as travas, no banco.
 */

/** As condições que o banco confere para a OS entrar em produção (os_bloqueios_para). */
const CONDICOES: { codigo: string; rotulo: string; soVenda?: boolean; soNaEntrada?: boolean }[] = [
  // Só faz sentido enquanto a OS está no Atendimento: depois, "validado" seria
  // afirmar de OS antiga uma validação que nunca houve.
  { codigo: "atendimento_nao_validado", rotulo: "Atendimento validado pelo gestor", soVenda: true, soNaEntrada: true },
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
  const [validarAberto, setValidarAberto] = useState(false);
  const [operadorAberto, setOperadorAberto] = useState(false);
  const { roles, user } = useAuth();
  const gestor = ehGestor(roles);
  // Quem faz o próximo passo (15/11/2026): os pedidos ao gestor e os nomes da equipe.
  const pedidosAoGestor = usePedidosAoGestor();
  const equipeDaOs = useEquipeDaProducao(aberto);
  const { impressao, versoesAnteriores, mockups, anexos } = separarArquivos(os?.arquivos as ArquivoDaOs[] | undefined);
  const todos = [...impressao, ...versoesAnteriores, ...mockups, ...anexos];

  // Outra OS aberta começa na primeira arte, com o registro do aceite fechado.
  useEffect(() => {
    setEscolhido(0);
    setAceiteAberto(false);
    setValidarAberto(false);
    setOperadorAberto(false);
  }, [os?.id]);

  // Para VER (miniatura, mockup): URL de 15 min, bucket por bucket. Baixar pede
  // a sua própria URL na hora do clique — nunca vence na mão de quem baixa.
  const urls = useQuery({
    queryKey: ["ficha-os-arquivos", os?.id, todos.map((a) => a.id).join(",")],
    enabled: aberto && todos.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => urlsParaVer(todos, 900),
  });

  if (!os) return null;

  const etapaAtual = etapaDe(os.status);
  const agora = quemFazAgora(os, {
    travas: bloqueios,
    pedidosAoGestor: (pedidosAoGestor.data ?? []).filter((p) => p.os_id === os.id).map((p) => p.assunto),
  });
  const nomeDaPessoa = (id: string) => {
    const nome = equipeDaOs.data?.find((p) => p.id === id)?.nome;
    return nome ? primeiroNome(nome) : null;
  };
  const prazo = prazoEmPalavras(os.prazo_entrega);
  const producao = resumoDaProducao(os.itens);
  const parada = paradaHa(os.ultimo_movimento?.mudou_em ?? os.updated_at);
  const foraDoFluxo = etapaAtual === "fora_do_fluxo";
  const maquina = identidadeDaMaquina(os);
  const interna = os.finalidade && os.finalidade !== "venda";
  const falta = new Map(bloqueios.map((b) => [b.codigo, b]));
  const condicoes = CONDICOES.filter((c) => !(interna && c.soVenda)).filter(
    (c) => !c.soNaEntrada || etapaAtual === "entrada" || falta.has(c.codigo),
  );
  const pendencias = condicoes.filter((c) => falta.has(c.codigo));
  const pendentes = pendencias.length;
  const certas = condicoes.filter((c) => !falta.has(c.codigo));
  // Pendência que o banco devolve e esta lista não conhece: aparece mesmo assim.
  const desconhecidas = bloqueios.filter((b) => !CONDICOES.some((c) => c.codigo === b.codigo));
  const mockup = mockups[Math.min(escolhido, Math.max(mockups.length - 1, 0))] ?? null;
  // Para a pendência "Sem arquivo final": primeiro o arquivo de impressão que subiu sem a
  // marcação (o perfil de quem enviou não podia marcar), depois o mockup na tela, depois o
  // primeiro anexo (revisão do PR #466).
  const candidatoAFinal = impressao.find((a) => !a.final_producao) ?? mockup ?? anexos[0] ?? null;
  const itensDaOs = ((os.itens as any[]) ?? []).filter((i) => i?.id);
  const nomeDoItem = new Map<string, string>(
    itensDaOs.map((i): [string, string] => [i.id as string, String(i.descricao ?? "").trim()]),
  );
  // A medida da peça do arquivo (para a conferência de resolução): a do item do
  // arquivo; sem item no arquivo, só quando a OS tem um item só.
  const medidaDo = (a: ArquivoDaOs): { largura: number; altura: number } | null => {
    const item = a.os_item_id ? itensDaOs.find((i) => i.id === a.os_item_id) : itensDaOs.length === 1 ? itensDaOs[0] : null;
    const largura = Number(item?.largura);
    const altura = Number(item?.altura);
    return largura > 0 && altura > 0 ? { largura, altura } : null;
  };
  // Tudo certo e ainda antes da fila: o próximo passo é um toque.
  // A fila pede o operador: o botão abre a escolha (14/11/2026).
  const podeIrParaAFila =
    pendentes === 0 &&
    desconhecidas.length === 0 &&
    (etapaAtual === "entrada" || etapaAtual === "validado" || etapaAtual === "pre_impressao");
  const podeTrocarOperador = etapaAtual === "fila_producao" || etapaAtual === "producao" || etapaAtual === "acabamento";

  const equipe: [string, string | null][] = [
    ["Responsável", os.responsavel?.nome ?? null],
    ["Criação", os.designer?.nome ?? null],
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
    // "Atendimento validado" é o aval do gestor, com quem faz a criação: abre a validação.
    if (novo === "briefing_ok" && etapaAtual === "entrada") {
      if (gestor) setValidarAberto(true);
      else toast.info("Só o gestor valida o atendimento. Use “Pedir a validação ao gestor”, em “Para produzir”.");
      return;
    }
    // A fila de produção pede quem vai produzir.
    if (novo === "aguardando_producao") {
      setOperadorAberto(true);
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
              <span className="ml-2 font-mono text-[color:var(--status-positive)]">{brl(Number(os.valor_total))}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(92dvh-6.5rem)] overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* ───── Os arquivos: o que vai para a máquina, o que o cliente aprovou, o resto ───── */}
          <section aria-label="Arquivos da OS" className="space-y-6 border-b border-border p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <Printer className="h-3.5 w-3.5" aria-hidden /> Arquivo de impressão · o que vai para a máquina
              </h3>
              {impressao.length > 0 ? (
                <ul className="space-y-2" aria-label="Arquivos de impressão">
                  {impressao.map((a) => (
                    <LinhaDeImpressao
                      key={a.id}
                      arquivo={a}
                      url={urls.data?.get(a.caminho) ?? null}
                      item={a.os_item_id ? (nomeDoItem.get(a.os_item_id) ?? null) : null}
                      podeFinalizar={podeFinalizar}
                      medida={medidaDo(a)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-xs">
                  <p className="font-medium text-foreground">Sem arquivo de impressão</p>
                  <p className="mt-0.5 text-muted-foreground">
                    A máquina ainda não tem o que imprimir: falta o arquivo fechado (PDF, CDR, AI…) que a criação manda para a produção.
                    {mockups.length > 0 && " O mockup abaixo é o visual que o cliente aprovou — não é o arquivo de impressão."}
                  </p>
                  {!podeAnexar && <p className="mt-1.5 italic text-muted-foreground">Peça a quem pode anexar o arquivo da arte.</p>}
                </div>
              )}
              {podeAnexar && <AnexarArquivoRapido osId={os.id} papel="impressao" atuais={impressao} rotulo={impressao.length > 0 ? "Nova versão ou outro arquivo" : undefined} />}
              {versoesAnteriores.length > 0 && (
                <details className="rounded-md border border-border/60 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Versões anteriores ({versoesAnteriores.length}) — não imprimir
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {versoesAnteriores.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {a.nome} · v{a.versao ?? 1}
                        </span>
                        <BotaoBaixar arquivo={a} variante="ghost" />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <FileImage className="h-3.5 w-3.5" aria-hidden /> Mockup · o que o cliente viu e aprovou
              </h3>
              {mockup ? (
                <>
                  <Visualizador arquivo={mockup} url={urls.data?.get(mockup.caminho) ?? null} carregando={urls.isPending} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{mockup.nome}</div>
                      <SituacaoDoMockup status={mockup.status} />
                      {ehArquivoDeImpressao(mockup) && (
                        <div className="text-muted-foreground">É também o arquivo de impressão.</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <BotaoAbrir arquivo={mockup} />
                      <BotaoBaixar arquivo={mockup} />
                    </div>
                  </div>
                  {mockups.length > 1 && (
                    <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Mockups da OS">
                      {mockups.map((a, i) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => setEscolhido(i)}
                            aria-pressed={a.id === mockup.id}
                            aria-label={`Ver o mockup ${a.nome}`}
                            className={cn(
                              "relative h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted/50 text-xs text-muted-foreground",
                              a.id === mockup.id ? "border-[color:var(--bex-cyan)] ring-1 ring-[color:var(--bex-cyan)]" : "border-border hover:border-foreground/30",
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
                            {a.status === "aprovado" && (
                              <span className="absolute left-1 top-1 rounded bg-[color:var(--bex-lime)] px-1 text-xs font-semibold text-black">aprovado</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p>
                    Sem mockup. É o visual que o cliente vê e aprova (a peça aplicada); costuma vir do orçamento ou da criação.
                  </p>
                  {podeAnexar && <AnexarArquivoRapido osId={os.id} papel="mockup" />}
                </div>
              )}
            </div>

            {anexos.length > 0 && (
              <details className="rounded-md border border-border/60 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  Outros anexos ({anexos.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {anexos.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="text-foreground/85">{a.nome}</span>
                        <span className="text-muted-foreground"> · {formatoDoArquivo(a)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {podeFinalizar && <MarcarComoFinal arquivoId={a.id} nome={a.nome} rotulo="É o de impressão" compacto />}
                        <BotaoBaixar arquivo={a} variante="ghost" />
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{rotuloDe(os.status)}</span>
                    {maquina && <SeloDaMaquina identidade={maquina} />}
                    {parada && <span className="font-mono">· parada há {parada}</span>}
                  </div>
                  {/* O próximo passo e quem responde por ele (15/11/2026). */}
                  {agora && (
                    <p className="mt-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
                      <span className="font-medium text-foreground">Agora: </span>
                      {agora.passo}
                      <span className="text-muted-foreground"> — {comQuem(agora, nomeDaPessoa, user?.id)}</span>
                    </p>
                  )}
                </>
              )}
            </Bloco>

            {/* A máquina: o operador escolhe (15/11/2026). */}
            {(etapaAtual === "fila_producao" || etapaAtual === "producao") && (
              <Bloco titulo="Máquina">
                <MaquinaDaOs os={os} />
              </Bloco>
            )}

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
                        <div className="mt-0.5 pl-5 text-xs text-muted-foreground">{b.resolver}</div>
                        <div className="mt-2 pl-5">
                          <AcaoDaPendencia
                            codigo={c.codigo}
                            osId={os.id}
                            arquivo={candidatoAFinal}
                            temArquivos={todos.length > 0}
                            podeAnexar={podeAnexar}
                            podeFinalizar={podeFinalizar}
                            podeAceitar={podeAceitar}
                            aceiteAberto={aceiteAberto}
                            onAceiteAberto={setAceiteAberto}
                            onFechar={onFechar}
                            os={os}
                            gestor={gestor}
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
                      <div className="mt-0.5 pl-5 text-xs text-muted-foreground">{b.resolver}</div>
                    </li>
                  ))}
                </ul>
              )}
              {certas.length > 0 && (
                <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", pendentes > 0 && "mt-2")}>
                  <Check className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--status-positive)]" aria-hidden />
                  <span>
                    <span className="sr-only">Já está certo: </span>
                    {certas.map((c) => c.rotulo).join(" · ")}
                  </span>
                </p>
              )}
              {podeIrParaAFila && (
                <Button type="button" className="mt-3 w-full" onClick={() => setOperadorAberto(true)}>
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
                    <div className="mt-1.5 font-mono text-xs text-muted-foreground">Metragem total: {areaEmTexto(producao.areaTotal)}</div>
                  )}
                </>
              ) : (
                <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Nenhum item cadastrado nesta OS. Sem item, a produção não sabe o que fazer nem o estoque o que baixar.
                </p>
              )}
              <FichaDoTrofeuDaOs osId={os.id} />
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
                {podeTrocarOperador && <TrocarOperador os={os} />}
              </div>
              <div className="mt-2">
                <AutorizacoesDaOs osId={os.id} />
              </div>
              {os.briefing && (
                <div className="mt-3 rounded border border-border/60 bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">{os.briefing}</div>
              )}
            </Bloco>

            <Bloco titulo="Quem fez o quê">
              <LinhaDoTempoDaOs osId={os.id} />
            </Bloco>

            <Bloco titulo="Mover para">
              <Select value={os.status} onValueChange={escolherEtapa}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fluxoParaEscolher(os.status).map((et) => (
                    <SelectGroup key={et.etapa}>
                      <SelectLabel className="text-xs uppercase tracking-wider">{et.rotulo}</SelectLabel>
                      {et.status.map((s) => (
                        <SelectItem key={s.status} value={s.status}>
                          {s.rotulo}
                          {s.dica && <span className="ml-1.5 text-xs text-muted-foreground">{s.dica}</span>}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">Também dá para arrastar o cartão.</p>
            </Bloco>

            <ValidarAtendimentoDialog os={os} aberto={validarAberto} onAberto={setValidarAberto} />
            <EscolherOperadorDialog os={os} aberto={operadorAberto} onAberto={setOperadorAberto} />

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
  os,
  gestor,
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
  os: { id: string; numero?: number | null; designer_id?: string | null; operador_id?: string | null };
  /** Só o gestor: valida o atendimento e libera saldo devedor e margem (o admin só acompanha). */
  gestor: boolean;
}) {
  switch (codigo) {
    case "atendimento_nao_validado":
      return gestor ? (
        <ValidarAtendimento os={os} />
      ) : (
        <PedirAoGestor osId={osId} assunto="atendimento" rotulo="Pedir a validação ao gestor" />
      );
    case "arte_nao_aprovada":
      return podeAceitar ? (
        <AceiteDaArteRapido osId={osId} aberto={aceiteAberto} onAbertoChange={onAceiteAberto} />
      ) : (
        <Pedir texto="Peça a quem pode registrar o aceite da arte." />
      );
    case "sem_arquivo_final":
      if (temArquivos && arquivo && podeFinalizar)
        return <MarcarComoFinal arquivoId={arquivo.id} nome={arquivo.nome} rotulo="Usar como arquivo de impressão" />;
      // Sem arquivo nenhum, o botão de anexar já está na área do arquivo de impressão: aqui só aponta, para não haver dois iguais.
      if (!temArquivos && podeAnexar) return <Pedir texto="Use o botão “Anexar arquivo de impressão”, à esquerda." />;
      return <Pedir texto={temArquivos ? "Peça a quem pode marcar o arquivo como final." : "Peça a quem pode anexar o arquivo."} />;
    case "sem_pagamento":
      // Cliente que vai ficar devendo: só o gestor libera (14/11/2026).
      return (
        <div className="flex flex-wrap items-start gap-2">
          <IrPara osId={osId} rotulo="Registrar na OS" onFechar={onFechar} />
          {gestor ? (
            <AutorizarSaldoDevedor osId={osId} />
          ) : (
            <PedirAoGestor osId={osId} assunto="saldo_devedor" rotulo="Vai ficar devendo: pedir ao gestor" />
          )}
        </div>
      );
    case "margem_baixa":
      // Margem abaixo do mínimo: revisar o preço na OS, ou o gestor libera (14/11/2026).
      return (
        <div className="flex flex-wrap items-start gap-2">
          <IrPara osId={osId} rotulo="Revisar o preço" onFechar={onFechar} />
          {gestor ? (
            <AutorizarMargemBaixa osId={osId} />
          ) : (
            <PedirAoGestor osId={osId} assunto="margem_baixa" rotulo="Pedir ao gestor para liberar" />
          )}
        </div>
      );
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
  return <p className="text-xs italic text-muted-foreground">{texto}</p>;
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

/** Uma linha do arquivo de impressão: miniatura (ou o formato), nome, tamanho, versão, item e o Baixar. */
function LinhaDeImpressao({
  arquivo,
  url,
  item,
  podeFinalizar,
  medida,
}: {
  arquivo: ArquivoDaOs;
  url: string | null;
  item: string | null;
  podeFinalizar: boolean;
  /** Largura e altura da peça em metros — para a conferência de resolução. */
  medida: { largura: number; altura: number } | null;
}) {
  const imagem = ehImagemVisivel(arquivo.nome, arquivo.mime_type, arquivo.caminho);
  const [px, setPx] = useState<{ largura: number; altura: number } | null>(null);
  const resolucao = imagem && px && medida ? resolucaoNoTamanho(px, medida) : null;
  // PDF: a medida da 1ª página contra a da peça (bate, sangria, escala ou diferente).
  const pdf = ehPdf(arquivo.nome, arquivo.mime_type, arquivo.caminho);
  const [paginaPdf, setPaginaPdf] = useState<{ largura: number; altura: number; paginas: number } | null>(null);
  useEffect(() => {
    setPaginaPdf(null);
    if (!pdf || !url || !medida) return;
    let vivo = true;
    // Falhou a leitura (PDF protegido, rede): fica sem a conferência, como antes.
    medirPdf(url)
      .then((m) => vivo && setPaginaPdf(m))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [pdf, url, medida?.largura, medida?.altura]);
  const conferenciaPdf = paginaPdf && medida ? conferirMedidaDoPdf(paginaPdf, medida) : null;
  const detalhe = [
    formatoDoArquivo(arquivo),
    tamanhoLegivel(arquivo.tamanho_bytes ?? null),
    (arquivo.versao ?? 1) > 1 ? `v${arquivo.versao}` : null,
    item,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-[color:var(--status-positive)]/40 bg-[color:var(--status-positive)]/5 p-2.5">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
        {imagem && url ? (
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onLoad={(e) => setPx({ largura: e.currentTarget.naturalWidth, altura: e.currentTarget.naturalHeight })}
          />
        ) : (
          formatoDoArquivo(arquivo)
        )}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate font-medium text-foreground">{arquivo.nome}</div>
        <div className="text-muted-foreground">{detalhe.join(" · ")}</div>
        {ehMockup(arquivo) && <div className="text-muted-foreground">É também o mockup que o cliente viu.</div>}
        {!arquivo.final_producao && (
          <div className="text-[color:var(--bex-amber)]">Ainda não marcado como final de produção.</div>
        )}
        {resolucao && (
          <div className={resolucao.nivel === "baixa" ? "text-[color:var(--bex-amber)]" : "text-muted-foreground"}>
            {textoDaResolucao(resolucao)}
          </div>
        )}
        {conferenciaPdf && (
          <div className={conferenciaPdf.alerta ? "text-[color:var(--bex-amber)]" : "text-muted-foreground"}>
            {conferenciaPdf.texto}
            {paginaPdf && paginaPdf.paginas > 1 && ` O PDF tem ${paginaPdf.paginas} páginas.`}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!arquivo.final_producao && podeFinalizar && (
          <MarcarComoFinal arquivoId={arquivo.id} nome={arquivo.nome} rotulo="Marcar como final" compacto />
        )}
        <BotaoBaixar arquivo={arquivo} variante="default" />
        {(imagem || ehPdf(arquivo.nome, arquivo.mime_type, arquivo.caminho)) && <BotaoAbrir arquivo={arquivo} />}
      </div>
    </li>
  );
}

/** A situação do mockup na aprovação do cliente — em palavras, não só em cor. */
function SituacaoDoMockup({ status }: { status?: string | null }) {
  if (status === "aprovado") return <div className="text-[color:var(--status-positive)]">Aprovado pelo cliente</div>;
  if (status === "rejeitado") return <div className="text-[color:var(--bex-amber)]">O cliente pediu ajuste</div>;
  return <div className="text-muted-foreground">Ainda sem a aprovação do cliente neste arquivo</div>;
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
          <span className="text-xs">
            {carregando && imagem
              ? "Carregando a imagem…"
              : imagem
                ? "Não foi possível mostrar a imagem agora."
                : "Este formato não abre aqui. Use “Baixar” para ver o arquivo."}
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
      <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}
