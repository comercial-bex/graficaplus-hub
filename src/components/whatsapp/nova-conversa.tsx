import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { abrirConversaPeloNumero } from "@/lib/api/whatsapp-caixa.functions";
import { lerNumeroColado } from "@/domain/whatsapp/numero-colado";
import { CHAVES } from "@/components/whatsapp/usar-caixa-de-entrada";
import { digitando } from "@/components/whatsapp/acoes-da-conversa";
import { Dica } from "@/components/bex/Dica";
import { dicaAcao } from "@/lib/dicas";

type ConversaDoNumero = {
  id: string;
  nome_contato: string | null;
  status: string;
  cliente: { nome: string } | null;
};

/**
 * Nova conversa pelo número (21/10/2026, pedido do dono): colar o número,
 * dar um nome ao contato e já cair na conversa para escrever. Antes só se
 * começava conversa pela ficha de um cliente cadastrado.
 *
 * Antes do clique a tela diz o que vai acontecer — a conversa que já existe
 * (abre a mesma), o cliente cadastrado com esse número, ou contato novo. Quem
 * decide de verdade é o servidor (`abrirConversaPeloNumero`, regra do AGENTS.md:
 * escrita da caixa nunca direto do navegador). Nada é enviado ao cliente.
 */
export function NovaConversa({
  aberto,
  onAberto,
  numeroInicial,
  onAberta,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  /** O número que já veio da busca da caixa. */
  numeroInicial?: string;
  onAberta: (conversaId: string) => void;
}) {
  const qc = useQueryClient();
  const abrir = useServerFn(abrirConversaPeloNumero);
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const abrindoRef = useRef(false);
  const nomeRef = useRef<HTMLInputElement>(null);

  // Cada vez que abre começa do zero — com o número da busca, se veio de lá.
  useEffect(() => {
    if (!aberto) return;
    setNumero(numeroInicial ?? "");
    setNome("");
  }, [aberto, numeroInicial]);

  const lido = lerNumeroColado(numero);
  const chave = lido.ok ? lido.chave : null;

  const existente = useQuery({
    queryKey: [...CHAVES.conversas, "nova-pelo-numero", chave] as const,
    enabled: aberto && !!chave,
    queryFn: async () => {
      const [conversas, clientes] = await Promise.all([
        (supabase as any)
          .from("whatsapp_conversas")
          .select("id, nome_contato, status, cliente:clientes!whatsapp_conversas_cliente_id_fkey(nome)")
          .eq("telefone_normalizado", chave as string),
        supabase
          .from("clientes")
          .select("id, nome")
          .eq("telefone_normalizado", chave as string)
          .eq("ativo", true),
      ]);
      if (conversas.error) throw conversas.error;
      if (clientes.error) throw clientes.error;
      return {
        conversas: (conversas.data ?? []) as ConversaDoNumero[],
        clientes: (clientes.data ?? []) as { id: string; nome: string }[],
      };
    },
  });

  // Só para avisar antes do clique: a conversa que vale é a que o servidor acha
  // (uma por instância; na prática, a da instância da gráfica).
  const conversa = existente.data?.conversas.find((c) => c.status === "aberta" || c.status === "pendente")
    ?? existente.data?.conversas.find(Boolean)
    ?? null;
  const clientes = existente.data?.clientes ?? [];
  const nomeConhecido =
    conversa?.cliente?.nome?.trim() ||
    conversa?.nome_contato?.trim() ||
    (clientes.length === 1 ? clientes[0].nome.trim() : "");

  async function confirmar() {
    if (!lido.ok || abrindoRef.current) return;
    abrindoRef.current = true;
    setAbrindo(true);
    try {
      const r = await abrir({ data: { telefone: lido.chave, nome: nome.trim() || undefined } });
      const quem = r.cliente?.trim() || nome.trim() || lido.legivel;
      toast.success(r.nova ? `Conversa com ${quem} criada. Escreva a primeira mensagem.` : `A conversa com ${quem} já existia — aberta para você continuar.`);
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      onAberto(false);
      onAberta(r.id);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      abrindoRef.current = false;
      setAbrindo(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Cole o número do jeito que veio — com ou sem +55, o link wa.me ou só o celular. Nada é enviado
            até você escrever na conversa.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="nova-conversa-numero">WhatsApp</Label>
            <Input
              id="nova-conversa-numero"
              inputMode="tel"
              autoComplete="off"
              autoFocus={!numeroInicial}
              placeholder="(96) 99999-9999"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              onPaste={(e) => {
                // Colou um número bom: o próximo passo é o nome (ou Enter).
                if (lerNumeroColado(e.clipboardData.getData("text")).ok) {
                  setTimeout(() => nomeRef.current?.focus(), 0);
                }
              }}
              aria-describedby="nova-conversa-leitura"
            />
            <div id="nova-conversa-leitura" className="min-h-5 text-xs" aria-live="polite">
              {lido.ok ? (
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">
                    {lido.legivel}
                    {lido.dddPresumido && (
                      <span className="font-normal text-muted-foreground"> · sem DDD, usei o 96</span>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {existente.isPending
                      ? "Conferindo se já existe…"
                      : existente.isError
                        ? "Não deu para conferir agora — ao abrir, o sistema procura a conversa desse número."
                        : conversa
                          ? `Já existe conversa${nomeConhecido ? ` com ${nomeConhecido}` : ""} — abre a mesma${conversa.status === "resolvida" || conversa.status === "arquivada" ? ", reaberta" : ""}.`
                          : clientes.length === 1
                            ? `É o cliente ${clientes[0].nome.trim()} — a conversa já nasce ligada a ele.`
                            : clientes.length > 1
                              ? `${clientes.length} clientes têm esse número — a conversa nasce sem cliente; ligue depois no painel.`
                              : "Contato novo — a conversa entra na fila Comercial."}
                  </p>
                </div>
              ) : (
                lido.motivo && <p className="text-destructive">{lido.motivo}</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nova-conversa-nome">Nome do contato (opcional)</Label>
            <Input
              id="nova-conversa-nome"
              ref={nomeRef}
              autoFocus={!!numeroInicial}
              autoComplete="off"
              maxLength={120}
              placeholder={nomeConhecido || "Como a equipe vai ver na caixa"}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onAberto(false)} disabled={abrindo}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!lido.ok || abrindo}>
              {abrindo ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="mr-1 h-4 w-4" />
              )}
              {abrindo ? "Abrindo…" : "Abrir conversa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** N abre a Nova conversa — fora de campo de texto e sem outro diálogo aberto. */
export function useAtalhoNovaConversa(ativo: boolean, abrir: () => void) {
  const atual = useRef(abrir);
  atual.current = abrir;
  useEffect(() => {
    if (!ativo) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || digitando(e.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      if (e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      atual.current();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo]);
}

/** O botão que abre a Nova conversa, ao lado da busca da caixa. */
export function BotaoNovaConversa({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Dica texto={dicaAcao("/whatsapp", "nova_conversa")} className={cn("shrink-0", className)}>
      <Button type="button" variant="outline" size="sm" className="h-9" onClick={onClick}>
        <MessageSquarePlus className="mr-1 h-4 w-4" />
        Nova
      </Button>
    </Dica>
  );
}
