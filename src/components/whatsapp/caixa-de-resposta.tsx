import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  Send,
  StickyNote,
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { RespostasRapidasMenu } from "@/components/whatsapp/respostas-rapidas-menu";
import {
  chaveDoRascunho,
  gravarRascunho,
  lerRascunho,
  useRascunho,
} from "@/components/whatsapp/rascunhos";
import {
  useRespostasRapidas,
  type RespostaRapida,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import type { Liberacao } from "@/domain/whatsapp/caixa-de-entrada";
import type { DialogoDaConversa, Disponivel } from "@/domain/whatsapp/acoes-de-trabalho";
import { textoSemAcento } from "@/domain/whatsapp/linha-do-tempo";
import {
  ALTURA_MINIMA_DA_CAIXA_PX,
  alturaDaCaixa,
  andarNaLista,
  haCamadaPorCima,
  letraVaiParaACaixa,
  oQueATeclaFazNaLista,
  oQueOEnterFaz,
  precisaConfirmarBarra,
} from "@/domain/whatsapp/teclado";
import { DICAS_WA_CONVERSA } from "@/lib/dicas";
import { cn } from "@/lib/utils";

/**
 * A caixa de resposta no jeito do WhatsApp (onda 1, 12/11/2026). Dono: CONVERSA.
 *
 * Uma linha que cresce até 6 linhas; [+] (44 px) com Documento ou foto,
 * Orçamento, Criar OS e Nota interna; respostas rápidas pelo "/" (com teclado)
 * e por um botão; Enviar de 44 px. A nota interna nunca foi usada mas continua,
 * dentro do [+]; no modo nota a caixa fica amarela e há um [x] para voltar.
 *
 * Teclado (regras puras em domain/whatsapp/teclado.ts, presas por teste):
 *   Enter envia; Shift+Enter quebra a linha; Ctrl+Enter também envia; no
 *   aparelho de toque o Enter quebra a linha; na composição de acento o Enter
 *   nunca envia. Com a lista do "/" aberta, as setas andam, Enter e Tab
 *   escolhem, Esc fecha e o Enter NUNCA envia. Texto que começa com "/" não
 *   sai sem a confirmação "Enviar mesmo assim?": no laboratório de 11/11,
 *   "/pix" mais Ctrl+Enter mandou "/pix" literal ao cliente. Letra digitada
 *   fora de qualquer campo vai para esta caixa.
 */

export type OpcoesDoEnvio = { confirmouBarra?: boolean };

/** Aparelho de toque (pointer: coarse): o Enter quebra a linha e o envio é pelo botão. */
function useToque(): boolean {
  const [toque, setToque] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const lista = window.matchMedia("(pointer: coarse)");
    setToque(lista.matches);
    const mudou = (e: MediaQueryListEvent) => setToque(e.matches);
    lista.addEventListener("change", mudou);
    return () => lista.removeEventListener("change", mudou);
  }, []);
  return toque;
}

export function CaixaDeResposta({
  conversaId,
  modo,
  onModo,
  enviando,
  temPermissaoDeResponder,
  liberacao,
  disponivel,
  onAbrirDialogo,
  onEnviar,
  onAnexar,
  respostaRef,
}: {
  conversaId: string;
  modo: "mensagem" | "nota";
  onModo: (m: "mensagem" | "nota") => void;
  enviando: boolean;
  temPermissaoDeResponder: boolean;
  liberacao: Liberacao;
  disponivel: Record<DialogoDaConversa, Disponivel>;
  onAbrirDialogo: (d: DialogoDaConversa) => void;
  onEnviar: (opcoes?: OpcoesDoEnvio) => void;
  onAnexar: (arquivo: File) => void;
  respostaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const nota = modo === "nota";
  // Nota interna e mensagem ao cliente têm rascunhos separados (ver rascunhos.ts).
  const chave = chaveDoRascunho(conversaId, nota);
  const [texto, setTexto] = useRascunho(chave);
  const respostas = useRespostasRapidas();
  const toque = useToque();
  const anexoRef = useRef<HTMLInputElement>(null);
  const idDaLista = useId();
  const [indice, setIndice] = useState(0);
  const [fechada, setFechada] = useState(false);
  const [confirmarBarra, setConfirmarBarra] = useState(false);

  const bloqueada = !nota && !liberacao.liberado;
  const campoAtivo = temPermissaoDeResponder && !bloqueada;

  // A lista do "/": só no modo mensagem, com o "/" no começo e pelo menos uma resposta que case.
  const atalho = !nota && texto.startsWith("/") ? textoSemAcento(texto.slice(1)) : null;
  const sugestoes: RespostaRapida[] =
    atalho === null
      ? []
      : (respostas.data ?? [])
          .filter((r) => textoSemAcento(`${r.titulo} ${r.categoria}`).includes(atalho))
          .slice(0, 6);
  const listaAberta = sugestoes.length > 0 && !fechada;

  useEffect(() => {
    setIndice(0);
    setFechada(false);
  }, [atalho]);

  // A caixa cresce com o texto, de uma linha até seis; depois rola por dentro.
  useLayoutEffect(() => {
    const el = respostaRef.current;
    if (!el) return;
    // Vazia: uma linha, sem medir. O texto de ajuda (placeholder) quebrava em
    // 3 linhas a 375 px e entrava no scrollHeight (92 px com a caixa vazia).
    if (texto === "") {
      el.style.height = `${ALTURA_MINIMA_DA_CAIXA_PX}px`;
      return;
    }
    el.style.height = "auto";
    const borda = el.offsetHeight - el.clientHeight;
    el.style.height = `${alturaDaCaixa(el.scrollHeight + borda)}px`;
  }, [texto, nota, bloqueada, respostaRef]);

  // Letra digitada fora de qualquer campo, sem diálogo aberto, vai para esta caixa.
  useEffect(() => {
    if (!campoAtivo) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (!letraVaiParaACaixa(e, e.target, haCamadaPorCima(document))) return;
      const el = respostaRef.current;
      if (!el || el.readOnly || el.disabled) return;
      e.preventDefault();
      const novo = lerRascunho(chave) + e.key;
      gravarRascunho(chave, novo);
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(novo.length, novo.length));
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [campoAtivo, chave, respostaRef]);

  function escolher(r: RespostaRapida) {
    setTexto(r.texto);
    setFechada(true);
    requestAnimationFrame(() => {
      const el = respostaRef.current;
      el?.focus();
      el?.setSelectionRange(r.texto.length, r.texto.length);
    });
  }

  function pedirEnvio() {
    if (!texto.trim() || enviando) return;
    if (precisaConfirmarBarra(texto, nota)) setConfirmarBarra(true);
    else onEnviar();
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const tecla = {
      key: e.key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: e.nativeEvent.isComposing,
      keyCode: e.keyCode,
    };
    if (listaAberta) {
      const acao = oQueATeclaFazNaLista(tecla);
      if (!acao) return;
      // Esc, Enter e Tab são consumidos aqui: o Esc da moldura (que fecha a
      // conversa) vê o evento já tratado e não faz nada.
      e.preventDefault();
      if (acao === "descer") setIndice((i) => andarNaLista(i, sugestoes.length, 1));
      else if (acao === "subir") setIndice((i) => andarNaLista(i, sugestoes.length, -1));
      else if (acao === "fechar") setFechada(true);
      else escolher(sugestoes[Math.min(indice, sugestoes.length - 1)]);
      return;
    }
    const acao = oQueOEnterFaz(tecla, { listaDaBarraAberta: false, toque, texto, nota });
    if (acao === "enviar") {
      e.preventDefault();
      pedirEnvio();
    } else if (acao === "confirmar_barra") {
      e.preventDefault();
      if (!enviando) setConfirmarBarra(true);
    } else if (acao === "ignorar") {
      e.preventDefault();
    }
  }

  function itemComMotivo(d: DialogoDaConversa, rotulo: string, icone: React.ReactNode) {
    const v = disponivel[d];
    return (
      <div key={d}>
        <DropdownMenuItem
          className="min-h-11 text-base"
          disabled={!v.pode}
          onSelect={() => setTimeout(() => onAbrirDialogo(d), 0)}
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
  }

  const podeAnexar = liberacao.liberado && !enviando;
  const rotuloDoEnvio = nota ? "Gravar nota" : "Enviar";

  return (
    <div className="relative shrink-0 border-t bg-card p-2">
      {listaAberta && (
        <ul
          id={idDaLista}
          role="listbox"
          aria-label="Respostas rápidas"
          className="absolute bottom-full left-2 right-2 z-10 mb-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {sugestoes.map((r, i) => (
            <li
              key={r.id}
              id={`${idDaLista}-${i}`}
              role="option"
              aria-selected={i === indice}
              // mousedown e não click: o clique não tira o cursor da caixa de texto.
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(r);
              }}
              onMouseEnter={() => setIndice(i)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5",
                i === indice && "bg-muted",
              )}
            >
              <span className="text-base font-medium leading-6">{r.titulo}</span>
              <span className="line-clamp-1 text-sm text-muted-foreground">{r.texto}</span>
            </li>
          ))}
        </ul>
      )}

      {nota && (
        <p className="mb-1.5 flex items-center gap-1.5 px-1 text-sm text-chat-nota-texto">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />A nota fica só na equipe. Ela nunca vai para o
          cliente.
        </p>
      )}

      <div
        className={cn(
          "flex items-end gap-1 rounded-3xl",
          nota && "bg-chat-nota px-1 py-1 text-chat-nota-texto",
        )}
      >
        {nota ? (
          <Dica texto="Voltar a escrever uma mensagem para o cliente.">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              aria-label="Cancelar a nota e voltar para a mensagem"
              onClick={() => onModo("mensagem")}
            >
              <X className="h-5 w-5" />
            </Button>
          </Dica>
        ) : (
          temPermissaoDeResponder && (
            <>
              <input
                ref={anexoRef}
                type="file"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAnexar(f);
                  e.target.value = "";
                }}
              />
              <DropdownMenu>
                <Dica texto={DICAS_WA_CONVERSA.mais_na_caixa}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 rounded-full"
                      aria-label="Mais: documento ou foto, orçamento, OS e nota interna"
                    >
                      <Plus className="h-6 w-6" />
                    </Button>
                  </DropdownMenuTrigger>
                </Dica>
                <DropdownMenuContent align="start" side="top" className="w-72 max-w-[calc(100vw-1rem)]">
                  <DropdownMenuItem
                    className="min-h-11 text-base"
                    disabled={!podeAnexar}
                    onSelect={() => anexoRef.current?.click()}
                  >
                    <Paperclip aria-hidden />
                    Documento ou foto
                  </DropdownMenuItem>
                  {!liberacao.liberado && (
                    <p role="presentation" className="px-2 pb-2 text-sm text-muted-foreground">
                      {liberacao.motivo}
                    </p>
                  )}
                  {itemComMotivo("orcamento", "Criar orçamento", <FileText aria-hidden />)}
                  {itemComMotivo("os", "Criar OS", <BriefcaseBusiness aria-hidden />)}
                  <DropdownMenuItem
                    className="min-h-11 text-base"
                    onSelect={() => {
                      onModo("nota");
                      setTimeout(() => respostaRef.current?.focus(), 0);
                    }}
                  >
                    <StickyNote aria-hidden />
                    Nota interna
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        )}

        {bloqueada ? (
          // Bloqueado: o motivo no lugar do campo. A nota interna segue no [+].
          <div
            role="status"
            className="flex min-h-11 min-w-0 flex-1 flex-col justify-center px-2 py-1 text-base leading-6"
          >
            <span className="font-medium">{liberacao.liberado ? "" : liberacao.rotulo}</span>
            <span className="text-sm text-muted-foreground">
              {liberacao.liberado ? "" : liberacao.motivo}
            </span>
          </div>
        ) : (
          <Textarea
            ref={respostaRef}
            rows={1}
            className={cn(
              "min-h-11 flex-1 resize-none rounded-2xl px-3 py-[9px] text-base leading-6 md:text-base",
              nota &&
                "border-transparent bg-transparent text-chat-nota-texto shadow-none placeholder:text-chat-nota-texto",
            )}
            placeholder={
              !temPermissaoDeResponder
                ? "Seu perfil só lê as conversas"
                : nota
                  ? "Nota interna para a equipe"
                  : "Mensagem"
            }
            value={texto}
            disabled={!temPermissaoDeResponder}
            readOnly={enviando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            aria-label={nota ? "Nota interna" : "Resposta"}
            aria-controls={listaAberta ? idDaLista : undefined}
            aria-activedescendant={listaAberta ? `${idDaLista}-${indice}` : undefined}
          />
        )}

        {temPermissaoDeResponder && !nota && !bloqueada && (
          <RespostasRapidasMenu
            className="rounded-full"
            onEscolher={(t) => setTexto(texto.trim() ? `${texto.trimEnd()}\n${t}` : t)}
          />
        )}

        {temPermissaoDeResponder && !bloqueada && (
          <Dica texto={DICAS_WA_CONVERSA.enviar}>
            <Button
              type="button"
              className={cn(
                "h-11 shrink-0 rounded-full",
                nota ? "px-4 text-sm" : "w-11 px-0",
              )}
              variant={nota ? "outline" : "default"}
              onClick={pedirEnvio}
              disabled={enviando || !texto.trim()}
              aria-label={rotuloDoEnvio}
            >
              {enviando ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : nota ? (
                <StickyNote className="h-4 w-4" aria-hidden />
              ) : (
                <Send className="h-5 w-5" aria-hidden />
              )}
              {nota && "Gravar nota"}
            </Button>
          </Dica>
        )}
      </div>

      <AlertDialog open={confirmarBarra} onOpenChange={setConfirmarBarra}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            respostaRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar mesmo assim?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              O texto começa com /. Se a ideia era uma resposta rápida, volte e escolha na lista: o
              cliente receberia essa barra escrita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Voltar e editar</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => onEnviar({ confirmouBarra: true })}>
              Enviar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
