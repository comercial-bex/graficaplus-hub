import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { mensagemErro } from "@/lib/erros";
import { chaveWhatsApp } from "@/domain/documentos";
import { telefoneLegivel, type ConversaDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import {
  CHAVES,
  useClientesParaVincular,
  vincularCliente,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { FECHAR_DE_44_PX } from "@/components/whatsapp/fechar-de-44-px";

/**
 * Liga a conversa a um cliente cadastrado.
 *
 * O webhook já liga sozinho quando o telefone bate com UM cliente. Sobra o
 * caso comum da gráfica: o cliente escreve de um número que não está no
 * cadastro (o celular do funcionário, o pessoal do dono). A escolha é de quem
 * atende — nunca "o primeiro da lista". Os clientes com o mesmo número da
 * conversa aparecem primeiro, marcados.
 */
export function VincularCliente({
  conversa,
  aberto: abertoPeloPai,
  onAberto,
}: {
  conversa: ConversaDaCaixa;
  /**
   * Controlado (onda 1, 12/11/2026): o menu da conversa e a gaveta abrem o mesmo
   * diálogo, sem botão próprio. Antes era um Popover preso ao botão do painel, e
   * um Popover sem o botão não tem onde se ancorar; a escolha de cliente é uma
   * tarefa de atenção cheia, então virou diálogo.
   */
  aberto?: boolean;
  onAberto?: (aberto: boolean) => void;
}) {
  const qc = useQueryClient();
  const [abertoInterno, setAbertoInterno] = useState(false);
  const controlado = abertoPeloPai !== undefined;
  const aberto = controlado ? abertoPeloPai : abertoInterno;
  const setAberto = (v: boolean) => (controlado ? onAberto?.(v) : setAbertoInterno(v));
  const [gravando, setGravando] = useState(false);
  const clientes = useClientesParaVincular(aberto);
  const chaveDaConversa = chaveWhatsApp(conversa.telefone);

  const mesmoNumero = (c: { whatsapp_principal: string | null; telefone: string | null }) =>
    !!chaveDaConversa &&
    (chaveWhatsApp(c.whatsapp_principal) === chaveDaConversa ||
      chaveWhatsApp(c.telefone) === chaveDaConversa);

  const ordenados = [...(clientes.data ?? [])].sort(
    (a, b) => Number(mesmoNumero(b)) - Number(mesmoNumero(a)),
  );

  async function escolher(clienteId: string, nome: string) {
    setGravando(true);
    try {
      const r = await vincularCliente(conversa.id, clienteId);
      toast.success(
        `Conversa ligada a ${nome}.${r?.mensagens ? ` ${r.mensagens} mensagem(ns) do histórico foram junto.` : ""}`,
      );
      setAberto(false);
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      {!controlado && (
        <Button
          variant="outline"
          className="h-11 w-full justify-start"
          disabled={gravando}
          onClick={() => setAberto(true)}
        >
          <Link2 className="mr-2 h-4 w-4" />{" "}
          {conversa.cliente_id ? "Trocar o cliente" : "Vincular a um cliente"}
        </Button>
      )}
      <Dialog open={aberto} onOpenChange={(v) => !gravando && setAberto(v)}>
        <DialogContent className={`max-w-md gap-3 p-4 sm:p-6 ${FECHAR_DE_44_PX}`}>
          <DialogHeader>
            <DialogTitle>{conversa.cliente_id ? "Trocar o cliente" : "Vincular a um cliente"}</DialogTitle>
            <DialogDescription>
              Escolha o cliente cadastrado. Quem tem o mesmo número da conversa aparece primeiro.
            </DialogDescription>
          </DialogHeader>
          {clientes.isError ? (
            <div className="text-sm text-destructive">
              Não foi possível carregar os clientes: {mensagemErro(clientes.error)}
            </div>
          ) : clientes.isPending ? (
            <div className="text-sm text-muted-foreground">Carregando os clientes…</div>
          ) : (
            <Command
              className="rounded-md border"
              filter={(valor, busca) => (valor.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0)}
            >
              <CommandInput placeholder="Buscar cliente por nome ou telefone…" />
              <CommandList className="max-h-[50dvh]">
                <CommandEmpty>Nenhum cliente com esse termo. Cadastre em Clientes.</CommandEmpty>
                <CommandGroup>
                  {ordenados.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.nome} ${c.whatsapp_principal ?? ""} ${c.telefone ?? ""} ${c.id}`}
                      onSelect={() => void escolher(c.id, c.nome)}
                      disabled={gravando || c.id === conversa.cliente_id}
                      className="flex min-h-11 flex-col items-start justify-center gap-0.5"
                    >
                      <span className="font-medium">
                        {c.nome}
                        {c.id === conversa.cliente_id ? " (atual)" : ""}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {telefoneLegivel(c.whatsapp_principal ?? c.telefone) || "sem telefone"}
                        {mesmoNumero(c) ? " · mesmo número da conversa" : ""}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
