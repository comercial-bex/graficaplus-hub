import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  Camera,
  Clock,
  FileText,
  HelpCircle,
  Info,
  Keyboard,
  ListChecks,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Mic,
  MoreVertical,
  QrCode,
  Search,
  Sticker,
  User,
  Video,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rotuloDaPessoa } from "@/domain/whatsapp/equipe";
import { cn } from "@/lib/utils";
import { dicaTela, DICAS_WA_MOLDURA } from "@/lib/dicas";
import { SeloParceiro } from "@/components/crm/selo-parceiro";
import { ehLeadParceiro } from "@/domain/crm/tipo-do-lead";
import {
  iniciais,
  nomeDaConversa,
  previaDaConversa,
  type ConversaDaCaixa,
  type TipoDaPrevia,
} from "@/domain/whatsapp/caixa-de-entrada";
import { horaDaLinha } from "@/domain/whatsapp/moldura";
import {
  CHIPS_DA_LISTA,
  contarNaoLidas,
  mostrarFiltroDeFila,
  type ChipDaLista,
} from "@/domain/whatsapp/filtros-da-lista";
import type { Situacao } from "@/domain/whatsapp/situacao-conexao";
import {
  useFotosDosContatos,
  type ContagemDaFila,
  type PessoaDaEquipe,
  type UltimaMensagemDaConversa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { FotoDoContato } from "@/components/whatsapp/foto-do-contato";
import { BotaoNovaConversa } from "@/components/whatsapp/nova-conversa";
import { TiqueDaMensagem } from "@/components/whatsapp/tique-da-mensagem";
import { DialogoAtalhos } from "@/components/whatsapp/acoes-da-conversa";
import { resumoDoRascunho, useRascunhos } from "@/components/whatsapp/rascunhos";
import { lerNumeroColado } from "@/domain/whatsapp/numero-colado";
import {
  SETORES,
  corDaEspera,
  esperaDe,
  infoDoSetor,
  type FiltroDeSetor,
} from "@/domain/whatsapp/filas";

function estaAbertaOuPendente(s: string): boolean {
  return s === "aberta" || s === "pendente";
}

export type Contadores = {
  minhas: number;
  nao_atribuidas: number;
  todas: number;
  aberta: number;
  pendente: number;
  resolvida: number;
};

/** O ícone de cada tipo de mensagem na prévia da linha (a MOLDURA escolhe; o texto vem da MIDIA). */
const ICONE_DA_PREVIA: Partial<Record<TipoDaPrevia, LucideIcon>> = {
  imagem: Camera,
  audio: Mic,
  video: Video,
  documento: FileText,
  figurinha: Sticker,
  localizacao: MapPin,
  contato: User,
  sistema: Info,
};

/** A frase da lista vazia, sem travessão (12/11/2026). */
function vazio(chip: ChipDaLista | null, busca: string, setor: FiltroDeSetor): string {
  if (busca.trim()) {
    return "Nenhuma conversa com esse termo. Tente o telefone só com números. Número novo? Toque em Nova conversa e cole o número. Cliente cadastrado que ainda não escreveu? Abra a ficha dele em Clientes e toque em Conversar no WhatsApp.";
  }
  if (setor !== "todas" && setor !== "minhas_filas" && (chip === "abertas" || chip === null)) {
    return `Nenhuma conversa aberta em ${infoDoSetor(setor).rotulo}. Veja “Todas as filas” para as outras.`;
  }
  switch (chip) {
    case "nao_lidas":
      return "Nenhuma conversa com mensagem não lida. Tudo em dia.";
    case "sem_responsavel":
      return "Nenhuma conversa sem responsável. Tudo em dia.";
    case "minhas":
      return "Nenhuma conversa com você. Assuma uma em Sem responsável.";
    case "pendentes":
      return "Nenhuma conversa pendente.";
    case "resolvidas":
      return "Nenhuma conversa resolvida ainda.";
    default:
      return "Nenhuma conversa aberta. Quando um cliente escrever, ela aparece aqui.";
  }
}

type PropsDaLinha = {
  c: ConversaDaCaixa;
  selecionada: boolean;
  naoLidas: number;
  resp: PessoaDaEquipe | null;
  fotoUrl: string | null | undefined;
  ultima: UltimaMensagemDaConversa | undefined;
  /** O texto do rascunho desta conversa ("" = sem). Única coisa que muda a cada tecla. */
  rascunho: string;
  mostrarFila: boolean;
  onSelecionar: (id: string) => void;
};

/**
 * Uma linha da lista, de uns 72 px, como a do WhatsApp: foto de 48 px, nome de
 * 16 px, hora, prévia com o ícone do tipo e os tiques, espera e contador de
 * não lidas. `memo`: cada tecla de um rascunho avisa a lista, e só a linha
 * daquela conversa muda (`rascunho` é a única prop que muda).
 */
const LinhaDaConversa = memo(function LinhaDaConversa({
  c,
  selecionada,
  naoLidas,
  resp,
  fotoUrl,
  ultima,
  rascunho,
  mostrarFila,
  onSelecionar,
}: PropsDaLinha) {
  const nome = nomeDaConversa(c);
  const espera =
    c.status === "aberta" || c.status === "pendente" ? esperaDe(c.aguardando_desde) : null;
  const setorDaConversa = c.fila ? infoDoSetor(c.fila) : null;
  const comAssistente = c.modo === "auto" && !c.responsavel_id && estaAbertaOuPendente(c.status);
  const previa = previaDaConversa(c.ultima_mensagem);
  const Icone = ICONE_DA_PREVIA[previa.tipo];
  const resumoDoTexto = resumoDoRascunho(rascunho);
  const temRascunho = resumoDoTexto.length > 0;
  return (
    <button
      type="button"
      data-conversa-id={c.id}
      onClick={() => onSelecionar(c.id)}
      aria-current={selecionada ? "true" : undefined}
      className={cn(
        "flex min-h-[72px] w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selecionada && "bg-muted",
        ehLeadParceiro(c.lead?.tipo) && "border-l-4 border-l-lead-parceiro",
      )}
    >
      <FotoDoContato
        nome={nome}
        url={fotoUrl}
        className="size-12 shrink-0"
        classeDasIniciais="text-base"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-base", naoLidas > 0 ? "font-bold" : "font-medium")}>
              {nome}
            </span>
            <SeloParceiro tipo={c.lead?.tipo} />
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {/* A espera fica na primeira linha, perto da hora: na segunda ela
                comia a prévia (12 letras num celular de 375 px). */}
            {espera && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold",
                  corDaEspera(espera.nivel),
                )}
              >
                <Clock className="size-3.5" aria-hidden />
                <span className="sr-only">O cliente espera resposta há </span>
                {espera.texto}
              </span>
            )}
            <span
              className={cn(
                "text-xs",
                naoLidas > 0 ? "font-semibold text-chat-verde-texto" : "text-muted-foreground",
              )}
            >
              {horaDaLinha(c.ultima_mensagem_at)}
            </span>
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
            {temRascunho ? (
              <>
                <span className="shrink-0 font-medium text-chat-verde-texto">Rascunho:</span>
                <span className="truncate">{resumoDoTexto}</span>
              </>
            ) : (
              <>
                {ultima && <TiqueDaMensagem m={ultima} className="[&_svg]:size-4" />}
                {Icone && <Icone className="size-4 shrink-0" aria-hidden />}
                <span className="truncate">{previa.texto}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {mostrarFila && setorDaConversa && (
              <span className="inline-flex items-center">
                <span className={cn("size-2.5 rounded-full", setorDaConversa.ponto)} aria-hidden />
                <span className="sr-only">Fila {setorDaConversa.rotulo}</span>
              </span>
            )}
            {comAssistente && (
              <span className="inline-flex items-center text-muted-foreground">
                <span className="sr-only">Com a assistente</span>
                <Bot className="size-4" aria-hidden />
              </span>
            )}
            {c.status === "arquivada" && <span className="text-xs text-muted-foreground">Arquivada</span>}
            {resp && (
              <Avatar className="size-6">
                {resp.avatar_url && <AvatarImage src={resp.avatar_url} alt="" />}
                <AvatarFallback className="text-xs">{iniciais(resp.nome)}</AvatarFallback>
              </Avatar>
            )}
            {resp && <span className="sr-only">Assumida por {rotuloDaPessoa(resp)}</span>}
            {naoLidas > 0 && (
              <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-chat-contador px-1.5 text-xs font-semibold text-chat-contador-texto"
                aria-label={`${naoLidas} não lida(s)`}
              >
                {naoLidas > 99 ? "99+" : naoLidas}
              </span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
});

/**
 * A coluna da esquerda, no jeito do WhatsApp (onda 1, 12/11/2026): topo com
 * "Conversas", o ponto da conexão, Nova conversa e o menu de três pontos; busca;
 * UMA fileira de chips; e as linhas. O filtro de fila só aparece quando há
 * conversa em mais de uma fila. Quem rola é a lista de linhas, não a coluna.
 */
export function ListaDeConversas({
  conversas,
  carregando,
  temMais,
  carregandoMais,
  onCarregarMais,
  contadores,
  equipe,
  selecionadaId,
  onSelecionar,
  busca,
  onBusca,
  chip,
  onChip,
  setor,
  onSetor,
  contagemPorFila,
  naoLidasPorMim,
  ultimasMensagens,
  onNovaConversa,
  conexao,
  podeConectar,
  podeAbrirRespostasRapidas,
  podeAbrirMonitor,
  className,
}: {
  /** Nova conversa pelo número; com o número já lido quando veio da busca. Só para quem responde. */
  onNovaConversa?: (numero?: string) => void;
  /** A situação da conexão para o ponto do topo; `null` enquanto não se sabe. */
  conexao: Situacao | null;
  /** Há conexão para fazer e a pessoa abre o Monitor: o ponto vira o link "Conectar". */
  podeConectar: boolean;
  podeAbrirRespostasRapidas: boolean;
  podeAbrirMonitor: boolean;
  /** O chip ativo; `null` quando o filtro não é de nenhum chip (vindo de fora). */
  chip: ChipDaLista | null;
  onChip: (c: ChipDaLista) => void;
  /** Caixa v3: o setor filtrado, a contagem de cada um e as não lidas de quem olha. */
  setor: FiltroDeSetor;
  onSetor: (s: FiltroDeSetor) => void;
  contagemPorFila: ContagemDaFila[] | undefined;
  naoLidasPorMim: Map<string, number> | undefined;
  /** O tique da última mensagem de cada conversa (só as que nós mandamos mostram tique). */
  ultimasMensagens: ReadonlyMap<string, UltimaMensagemDaConversa> | undefined;
  conversas: ConversaDaCaixa[];
  carregando: boolean;
  temMais: boolean;
  carregandoMais: boolean;
  onCarregarMais: () => void;
  contadores: Contadores | undefined;
  equipe: PessoaDaEquipe[];
  selecionadaId: string | null;
  onSelecionar: (id: string) => void;
  busca: string;
  onBusca: (v: string) => void;
  className?: string;
}) {
  const sentinela = useRef<HTMLDivElement>(null);
  const [atalhosAbertos, setAtalhosAbertos] = useState(false);
  const numeroDaBusca = lerNumeroColado(busca);
  const pessoas = new Map(equipe.map((p) => [p.id, p]));
  const fotos = useFotosDosContatos(conversas.map((c) => c.foto_path));
  const rascunhos = useRascunhos();

  // A linha é `memo`: o callback precisa ser o mesmo entre renderizações.
  const selecionarRef = useRef(onSelecionar);
  selecionarRef.current = onSelecionar;
  const selecionar = useCallback((id: string) => selecionarRef.current(id), []);

  const mostrarFila = mostrarFiltroDeFila({
    contagem: contagemPorFila,
    setor,
    listaVazia: !carregando && conversas.length === 0,
  });

  // "Carregar mais" ao rolar: quando o fim da lista aparece, busca a próxima página.
  useEffect(() => {
    const el = sentinela.current;
    if (!el || !temMais) return;
    const obs = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting) && !carregandoMais) onCarregarMais();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [temMais, carregandoMais, onCarregarMais]);

  const textoDaConexao = !conexao ? null : conexao.tom === "lime" ? "Conectado" : conexao.rotulo;
  const pontoDaConexao = !conexao
    ? ""
    : conexao.tom === "lime"
      ? "bg-status-positive"
      : conexao.tom === "amber"
        ? "bg-status-amber"
        : conexao.tom === "magenta"
          ? "bg-status-magenta"
          : "bg-muted-foreground";

  return (
    <section
      aria-label="Conversas"
      className={cn("flex min-h-0 flex-col border-r bg-card", className)}
    >
      <div className="shrink-0">
        <div className="flex items-center gap-1 px-3 pt-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold leading-tight">Conversas</h2>
            {textoDaConexao && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className={cn("size-2.5 shrink-0 rounded-full", pontoDaConexao)} aria-hidden />
                <span className="truncate">{textoDaConexao}</span>
                {podeConectar && (
                  <Link
                    to="/whatsapp-monitor"
                    aria-label="Conectar o WhatsApp"
                    className="-my-3 inline-flex min-h-11 items-center px-1 font-medium text-foreground underline underline-offset-2"
                  >
                    Conectar
                  </Link>
                )}
              </p>
            )}
          </div>
          {onNovaConversa && <BotaoNovaConversa onClick={() => onNovaConversa()} />}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Ajuda da caixa de entrada"
              >
                <HelpCircle className="size-6" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm leading-relaxed">
              {dicaTela("/whatsapp") && <p>{dicaTela("/whatsapp")}</p>}
              <p>{DICAS_WA_MOLDURA.conexao}</p>
              {conexao?.proximoPasso && <p className="font-medium">{conexao.proximoPasso}</p>}
              {mostrarFila && <p>{DICAS_WA_MOLDURA.filtro_de_fila}</p>}
              <p>{DICAS_WA_MOLDURA.atalhos}</p>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Mais opções da caixa"
              >
                <MoreVertical className="size-6" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              {podeAbrirRespostasRapidas && (
                <DropdownMenuItem asChild className="min-h-11 gap-2 text-base">
                  <Link to="/respostas-rapidas">
                    <ListChecks className="size-5" aria-hidden />
                    Respostas rápidas
                  </Link>
                </DropdownMenuItem>
              )}
              {podeAbrirMonitor && (
                <DropdownMenuItem asChild className="min-h-11 gap-2 text-base">
                  <Link to="/whatsapp-monitor">
                    <Activity className="size-5" aria-hidden />
                    Monitor do WhatsApp
                  </Link>
                </DropdownMenuItem>
              )}
              {podeConectar && (
                <DropdownMenuItem asChild className="min-h-11 gap-2 text-base">
                  <Link to="/whatsapp-monitor">
                    <QrCode className="size-5" aria-hidden />
                    Conectar o WhatsApp
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="min-h-11 gap-2 text-base"
                onSelect={() => setAtalhosAbertos(true)}
              >
                <Keyboard className="size-5" aria-hidden />
                Atalhos do teclado
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="px-3 pb-1 pt-1">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-11 pl-10 text-base"
              placeholder="Nome, telefone ou mensagem…"
              value={busca}
              onChange={(e) => onBusca(e.target.value)}
              onKeyDown={(e) => {
                // Esc com texto limpa a busca (e não fecha a conversa aberta).
                if (e.key === "Escape" && busca && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onBusca("");
                }
              }}
              aria-label="Buscar conversa"
            />
          </div>
        </div>

        {/* UMA fileira de chips; rola de lado quando não cabe. O alvo é de 44 px
            (o botão), o desenho é a pílula de dentro. */}
        <div
          className="flex gap-1 overflow-x-auto px-2"
          role="group"
          aria-label="Filtrar conversas"
        >
          {CHIPS_DA_LISTA.map((c) => {
            const ativo = chip === c.valor;
            const n =
              c.valor === "nao_lidas"
                ? contarNaoLidas(naoLidasPorMim)
                : c.valor === "pendentes"
                  ? (contadores?.pendente ?? 0)
                  : 0;
            return (
              <button
                key={c.valor}
                type="button"
                aria-pressed={ativo}
                onClick={() => onChip(c.valor)}
                className="group flex h-11 shrink-0 items-center px-1 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    ativo
                      ? "border-chat-contador bg-chat-contador text-chat-contador-texto"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  {c.rotulo}
                  {n > 0 && <span className="font-semibold">{n}</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* O filtro de fila só existe quando há conversa em mais de uma fila.
            O número é de conversas abertas; o relógio, de quem espera. */}
        {mostrarFila && (
          <div
            className="flex gap-1 overflow-x-auto px-2 pb-1"
            role="group"
            aria-label="Filas por setor"
          >
            {(["minhas_filas", "todas"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={setor === v}
                onClick={() => onSetor(v)}
                className="group flex h-11 shrink-0 items-center px-0.5 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border px-2.5 text-sm transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    setor === v
                      ? "border-foreground/30 bg-foreground/10 font-semibold text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {v === "minhas_filas" ? "Minhas filas" : "Todas as filas"}
                </span>
              </button>
            ))}
            {SETORES.map((s) => {
              const n = contagemPorFila?.find((c) => c.fila === s.valor);
              const ativo = setor === s.valor;
              return (
                <button
                  key={s.valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => onSetor(s.valor)}
                  className="group flex h-11 shrink-0 items-center px-0.5 focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                      ativo ? cn(s.cor, "font-semibold") : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span className={cn("size-2 rounded-full", s.ponto)} aria-hidden />
                    {s.rotulo}
                    {n && n.abertas > 0 && (
                      <span className="font-mono">
                        {n.abertas}
                        <span className="sr-only"> aberta(s)</span>
                      </span>
                    )}
                    {/* Quantos esperam resposta, à vista e para o leitor de tela. */}
                    {n && n.aguardando > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-mono font-semibold">
                        <Clock className="size-3.5" aria-hidden />
                        {n.aguardando}
                        <span className="sr-only"> esperando resposta</span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto border-t">
        {carregando ? (
          <div className="flex items-center gap-2 p-6 text-base text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Carregando…
          </div>
        ) : conversas.length === 0 ? (
          numeroDaBusca.ok && onNovaConversa ? (
            // Colou um número que ainda não tem conversa: chamar é um toque.
            <div className="space-y-3 p-6 text-center text-base text-muted-foreground">
              <p>Nenhuma conversa com {numeroDaBusca.legivel}.</p>
              <Button
                type="button"
                className="h-11 text-base"
                onClick={() => onNovaConversa(numeroDaBusca.chave)}
              >
                <MessageSquarePlus className="mr-2 size-5" aria-hidden />
                Chamar {numeroDaBusca.legivel}
              </Button>
            </div>
          ) : (
            <p className="p-6 text-center text-base text-muted-foreground">{vazio(chip, busca, setor)}</p>
          )
        ) : (
          conversas.map((c) => (
            <LinhaDaConversa
              key={c.id}
              c={c}
              selecionada={selecionadaId === c.id}
              // As de quem olha, quando já carregou; senão, o contador geral.
              naoLidas={naoLidasPorMim ? (naoLidasPorMim.get(c.id) ?? 0) : (c.nao_lidas ?? 0)}
              resp={c.responsavel_id ? (pessoas.get(c.responsavel_id) ?? null) : null}
              fotoUrl={c.foto_path ? fotos.data?.get(c.foto_path) : null}
              ultima={ultimasMensagens?.get(c.id)}
              rascunho={rascunhos.get(c.id) ?? ""}
              mostrarFila={mostrarFila && setor !== c.fila}
              onSelecionar={selecionar}
            />
          ))
        )}
        <div ref={sentinela} />
        {carregandoMais && (
          <div className="flex justify-center p-3 text-sm text-muted-foreground">
            <Loader2 className="mr-1 size-4 animate-spin" aria-hidden /> Carregando mais…
          </div>
        )}
        {temMais && !carregandoMais && (
          <button
            type="button"
            onClick={onCarregarMais}
            className="min-h-11 w-full p-3 text-sm text-muted-foreground hover:underline"
          >
            Carregar mais conversas
          </button>
        )}
      </div>

      <DialogoAtalhos aberto={atalhosAbertos} onAberto={setAtalhosAbertos} />
    </section>
  );
}
