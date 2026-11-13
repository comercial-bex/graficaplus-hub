import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCheck,
  FileText,
  Hand,
  Keyboard,
  Link2,
  MoreVertical,
  RotateCcw,
  Search,
  ArrowRightLeft,
  UserRound,
  X,
} from "lucide-react";
import { Dica } from "@/components/bex/Dica";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { StatusChip } from "@/components/bex/StatusChip";
import { SeloParceiro } from "@/components/crm/selo-parceiro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FotoDoContato } from "@/components/whatsapp/foto-do-contato";
import { ehLeadParceiro } from "@/domain/crm/tipo-do-lead";
import { telefoneLegivel, type ConversaDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { infoDoSetor } from "@/domain/whatsapp/filas";
import { acoesDoCabecalho } from "@/domain/whatsapp/acoes-do-cabecalho";
import type { DialogoDaConversa, Disponivel } from "@/domain/whatsapp/acoes-de-trabalho";
import type { ModoDaCaixa } from "@/domain/whatsapp/moldura";
import { DICAS_WA_CONVERSA } from "@/lib/dicas";
import { cn } from "@/lib/utils";

/**
 * O cabeçalho da conversa: UMA linha de 64 px (foto, nome, uma linha com
 * telefone, fila e responsável) e botões de 44 px. Dono: CONVERSA (onda 1,
 * 12/11/2026). Clicar na foto ou no nome abre os dados do contato.
 *
 * À vista (quando cabem, ver `apresentacaoDosBotoes`): Assumir (só quando não há
 * responsável ou é de outra pessoa; sendo de outra pessoa pede confirmação,
 * porque a antiga tecla R assumia sem perguntar), Resolver (vira Reabrir),
 * Orçamento, a lupa e os três pontos. Na conversa estreita (celular) só a lupa
 * e os três pontos ficam: Assumir, Resolver e Orçamento vão para o menu, para o
 * nome não sumir (a 375 px ele tinha 0 px e o menu saía da tela). No menu:
 * Transferir, Marcar pendente, Arquivar, Criar OS, Vincular cliente, Dados do
 * contato, Devolver à assistente e Atalhos do teclado. A regra de quem aparece
 * onde é `acoesDoCabecalho` (domain), presa por teste.
 */

/** Largura de um elemento, medida antes de pintar e a cada mudança (consulta de contêiner em JS). */
function useLargura(ref: React.RefObject<HTMLElement | null>): number | null {
  const [largura, setLargura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLargura(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada) setLargura(entrada.contentRect.width);
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [ref]);
  return largura;
}

/** Abrir diálogo de dentro do menu: espera o menu fechar antes (senão o foco do Radix briga com o diálogo). */
function depoisDoMenu(fazer: () => void) {
  setTimeout(fazer, 0);
}

const DESCRICAO_DO_ASSUMIR =
  "Ela passa a ser sua e a outra pessoa deixa de ser a responsável. O cliente não recebe aviso.";

export type PropsDoCabecalho = {
  conversa: ConversaDaCaixa;
  nome: string;
  fotoUrl: string | null | undefined;
  /** "Yvens · Gerência" ou null (sem responsável). */
  responsavel: string | null;
  modo: ModoDaCaixa;
  dadosAbertos: boolean;
  temPermissaoDeResponder: boolean;
  meuId: string | null;
  ocupado: boolean;
  iaLigada: boolean;
  disponivel: Record<DialogoDaConversa, Disponivel>;
  buscaAberta: boolean;
  onVoltar: () => void;
  onAlternarDados: () => void;
  onAbrirDialogo: (d: DialogoDaConversa) => void;
  onAssumir: () => void;
  onTransferir: () => void;
  onResolver: () => void;
  onStatus: (status: "aberta" | "pendente" | "arquivada", rotulo: string) => void;
  onDevolver: () => void;
  onAtalhos: () => void;
  onAlternarBusca: () => void;
};

export function CabecalhoDaConversa(p: PropsDoCabecalho) {
  const { conversa, disponivel } = p;
  const linha = useRef<HTMLElement>(null);
  const largura = useLargura(linha);
  const a = acoesDoCabecalho({
    temPermissaoDeResponder: p.temPermissaoDeResponder,
    status: conversa.status,
    responsavelId: conversa.responsavel_id,
    meuId: p.meuId,
    modo: p.modo,
    larguraDaConversa: largura,
    iaLigada: p.iaLigada,
    modoDaConversa: conversa.modo,
    disponivel,
  });
  const setor = conversa.fila ? infoDoSetor(conversa.fila) : null;
  const [confirmandoAssumir, setConfirmandoAssumir] = useState(false);
  const comTexto = a.apresentacao === "texto";
  const tituloDoAssumir = `Assumir a conversa de ${p.responsavel ?? "outra pessoa"}?`;

  // Itens do menu que dependem de permissão mostram o motivo, nunca somem.
  const itemComMotivo = (
    d: DialogoDaConversa,
    rotulo: string,
    icone: React.ReactNode,
  ) => {
    const v = disponivel[d];
    return (
      <div key={d}>
        <DropdownMenuItem
          className="min-h-11 text-base"
          disabled={!v.pode}
          onSelect={() => depoisDoMenu(() => p.onAbrirDialogo(d))}
        >
          {icone}
          {rotulo}
        </DropdownMenuItem>
        {!v.pode && (
          <p role="presentation" className="px-2 pb-2 text-sm text-muted-foreground">
            {v.motivo}
          </p>
        )}
      </div>
    );
  };

  const botaoOrcamento = (
    <Dica texto={DICAS_WA_CONVERSA.orcamento}>
      <Button
        type="button"
        variant="outline"
        className={cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")}
        aria-label="Criar orçamento da conversa"
        onClick={() => p.onAbrirDialogo("orcamento")}
      >
        <FileText className="h-4 w-4" aria-hidden />
        {comTexto && "Orçamento"}
      </Button>
    </Dica>
  );

  return (
    <header
      ref={linha}
      className={cn(
        "flex h-16 shrink-0 items-center gap-2 border-b px-2",
        ehLeadParceiro(conversa.lead?.tipo) && "border-l-4 border-l-lead-parceiro",
      )}
    >
      {p.modo === "estreito" && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={p.onVoltar}
          aria-label="Voltar às conversas"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}

      <Dica texto={DICAS_WA_CONVERSA.dados_do_contato} className="min-w-0 flex-1">
        <button
          type="button"
          onClick={p.onAlternarDados}
          aria-expanded={p.dadosAbertos}
          aria-label={`Dados do contato: ${p.nome}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FotoDoContato nome={p.nome} url={p.fotoUrl} className="size-10 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-base font-medium leading-6">{p.nome}</span>
              <SeloParceiro tipo={conversa.lead?.tipo} />
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-sm leading-5 text-muted-foreground">
              {conversa.status !== "aberta" && (
                <StatusChip
                  compacto
                  label={conversa.status}
                  tone={conversa.status === "pendente" ? "amber" : "muted"}
                />
              )}
              <span className="truncate">
                {telefoneLegivel(conversa.telefone)}
                {setor && (
                  <>
                    {" · "}
                    <span
                      className={cn("mr-1 inline-block h-2 w-2 rounded-full align-middle", setor.ponto)}
                      aria-hidden
                    />
                    {setor.rotulo}
                  </>
                )}
                {" · "}
                {p.responsavel ? p.responsavel : "sem responsável"}
              </span>
            </span>
          </span>
        </button>
      </Dica>

      {!a.situacaoNoMenu && a.assumir === "direto" && (
        <Dica texto={DICAS_WA_CONVERSA.assumir}>
          <Button
            type="button"
            variant="outline"
            className={cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")}
            aria-label="Assumir a conversa"
            disabled={p.ocupado}
            onClick={p.onAssumir}
          >
            <Hand className="h-4 w-4" aria-hidden />
            {comTexto && "Assumir"}
          </Button>
        </Dica>
      )}
      {!a.situacaoNoMenu && a.assumir === "confirmar" && (
        <ConfirmarAcao
          titulo={tituloDoAssumir}
          descricao={DESCRICAO_DO_ASSUMIR}
          rotuloConfirmar="Assumir"
          aoConfirmar={p.onAssumir}
        >
          <Button
            type="button"
            variant="outline"
            className={cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")}
            aria-label="Assumir a conversa"
            disabled={p.ocupado}
          >
            <Hand className="h-4 w-4" aria-hidden />
            {comTexto && "Assumir"}
          </Button>
        </ConfirmarAcao>
      )}
      {!a.situacaoNoMenu && a.situacao === "resolver" && (
        <Dica texto={DICAS_WA_CONVERSA.resolver}>
          <Button
            type="button"
            variant="outline"
            className={cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")}
            aria-label="Resolver a conversa"
            disabled={p.ocupado}
            onClick={p.onResolver}
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            {comTexto && "Resolver"}
          </Button>
        </Dica>
      )}
      {!a.situacaoNoMenu && a.situacao === "reabrir" && (
        <Dica texto={DICAS_WA_CONVERSA.reabrir}>
          <Button
            type="button"
            variant="outline"
            className={cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")}
            aria-label="Reabrir a conversa"
            disabled={p.ocupado}
            onClick={() => p.onStatus("aberta", "Conversa reaberta")}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {comTexto && "Reabrir"}
          </Button>
        </Dica>
      )}
      {a.orcamentoNoBotao && botaoOrcamento}

      <Dica texto={DICAS_WA_CONVERSA.buscar}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label="Buscar na conversa"
          aria-pressed={p.buscaAberta}
          onClick={p.onAlternarBusca}
        >
          <Search className="h-5 w-5" />
        </Button>
      </Dica>

      <DropdownMenu>
        <Dica texto={DICAS_WA_CONVERSA.mais_acoes}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Mais ações da conversa"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
        </Dica>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)]">
          {a.situacaoNoMenu && a.assumir !== "nenhum" && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() =>
                a.assumir === "confirmar"
                  ? depoisDoMenu(() => setConfirmandoAssumir(true))
                  : p.onAssumir()
              }
            >
              <Hand aria-hidden />
              Assumir
            </DropdownMenuItem>
          )}
          {a.situacaoNoMenu && a.situacao === "resolver" && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => depoisDoMenu(p.onResolver)}
            >
              <CheckCheck aria-hidden />
              Resolver
            </DropdownMenuItem>
          )}
          {a.situacaoNoMenu && a.situacao === "reabrir" && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => p.onStatus("aberta", "Conversa reaberta")}
            >
              <RotateCcw aria-hidden />
              Reabrir
            </DropdownMenuItem>
          )}
          {a.situacaoNoMenu && (a.assumir !== "nenhum" || a.situacao) && <DropdownMenuSeparator />}
          {a.transferir && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => depoisDoMenu(p.onTransferir)}
            >
              <ArrowRightLeft aria-hidden />
              Transferir
            </DropdownMenuItem>
          )}
          {a.pendente === "marcar" && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => p.onStatus("pendente", "Marcada como pendente")}
            >
              <Clock aria-hidden />
              Marcar pendente
            </DropdownMenuItem>
          )}
          {a.pendente === "tirar" && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => p.onStatus("aberta", "Conversa tirada de pendente")}
            >
              <Clock aria-hidden />
              Tirar de pendente
            </DropdownMenuItem>
          )}
          {a.arquivar && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => p.onStatus("arquivada", "Conversa arquivada")}
            >
              <Archive aria-hidden />
              Arquivar
            </DropdownMenuItem>
          )}
          {a.devolverAAssistente && (
            <DropdownMenuItem
              className="min-h-11 text-base"
              disabled={p.ocupado}
              onSelect={() => depoisDoMenu(p.onDevolver)}
            >
              <Bot aria-hidden />
              Devolver à assistente
            </DropdownMenuItem>
          )}
          {(a.transferir || a.pendente || a.arquivar || a.devolverAAssistente) && (
            <DropdownMenuSeparator />
          )}
          {a.orcamentoNoMenu &&
            itemComMotivo("orcamento", "Criar orçamento", <FileText aria-hidden />)}
          {itemComMotivo("os", "Criar OS", <BriefcaseBusiness aria-hidden />)}
          {itemComMotivo("vincular_cliente", "Vincular a um cliente", <Link2 aria-hidden />)}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 text-base"
            onSelect={() => depoisDoMenu(p.onAlternarDados)}
          >
            <UserRound aria-hidden />
            Dados do contato
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 text-base"
            onSelect={() => depoisDoMenu(p.onAtalhos)}
          >
            <Keyboard aria-hidden />
            Atalhos do teclado
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Assumir de dentro do menu (conversa estreita): a confirmação é controlada. */}
      <AlertDialog open={confirmandoAssumir} onOpenChange={setConfirmandoAssumir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tituloDoAssumir}</AlertDialogTitle>
            <AlertDialogDescription>{DESCRICAO_DO_ASSUMIR}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={p.onAssumir}>Assumir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

/**
 * A barra da busca na conversa, logo abaixo do cabeçalho: campo, "2 de 5",
 * anterior, próxima e fechar. Enter vai para a próxima (Shift+Enter, a
 * anterior); Esc fecha a busca e só ela (preventDefault, para o Esc da moldura
 * não fechar a conversa junto).
 */
export function BarraDeBuscaNaConversa({
  termo,
  onTermo,
  resumo,
  temOcorrencias,
  onAnterior,
  onProxima,
  onFechar,
}: {
  termo: string;
  onTermo: (t: string) => void;
  resumo: string;
  temOcorrencias: boolean;
  onAnterior: () => void;
  onProxima: () => void;
  onFechar: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
  }, []);
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b bg-card px-2">
      <Input
        ref={campo}
        type="search"
        value={termo}
        onChange={(e) => onTermo(e.target.value)}
        placeholder="Buscar nas mensagens"
        aria-label="Buscar nas mensagens da conversa"
        className="h-11 min-w-0 flex-1 text-base"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onFechar();
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.shiftKey) onAnterior();
            else onProxima();
          }
        }}
      />
      <span className="min-w-16 shrink-0 text-center text-sm text-muted-foreground" aria-live="polite">
        {resumo}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label="Ocorrência anterior"
        disabled={!temOcorrencias}
        onClick={onAnterior}
      >
        <ChevronUp className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label="Próxima ocorrência"
        disabled={!temOcorrencias}
        onClick={onProxima}
      >
        <ChevronDown className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label="Fechar a busca"
        onClick={onFechar}
      >
        <X className="h-5 w-5" />
      </Button>
    </div>
  );
}
