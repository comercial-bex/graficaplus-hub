import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/**
 * Liga a conversa a um cliente cadastrado.
 *
 * O webhook já liga sozinho quando o telefone bate com UM cliente. Sobra o
 * caso comum da gráfica: o cliente escreve de um número que não está no
 * cadastro (o celular do funcionário, o pessoal do dono). A escolha é de quem
 * atende — nunca "o primeiro da lista". Os clientes com o mesmo número da
 * conversa aparecem primeiro, marcados.
 */
export function VincularCliente({ conversa }: { conversa: ConversaDaCaixa }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
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
        `Conversa ligada a ${nome}${r?.mensagens ? ` — ${r.mensagens} mensagem(ns) do histórico levadas junto` : ""}.`,
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
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start" disabled={gravando}>
          <Link2 className="mr-2 h-4 w-4" />{" "}
          {conversa.cliente_id ? "Trocar o cliente" : "Vincular a um cliente"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {clientes.isError ? (
          <div className="p-3 text-sm text-destructive">
            Não foi possível carregar os clientes: {mensagemErro(clientes.error)}
          </div>
        ) : clientes.isPending ? (
          <div className="p-3 text-sm text-muted-foreground">Carregando os clientes…</div>
        ) : (
          <Command
            filter={(valor, busca) => (valor.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0)}
          >
            <CommandInput placeholder="Buscar cliente por nome ou telefone…" />
            <CommandList>
              <CommandEmpty>Nenhum cliente com esse termo. Cadastre em Clientes.</CommandEmpty>
              <CommandGroup>
                {ordenados.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.nome} ${c.whatsapp_principal ?? ""} ${c.telefone ?? ""} ${c.id}`}
                    onSelect={() => void escolher(c.id, c.nome)}
                    disabled={gravando || c.id === conversa.cliente_id}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">
                      {c.nome}
                      {c.id === conversa.cliente_id ? " (atual)" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {telefoneLegivel(c.whatsapp_principal ?? c.telefone) || "sem telefone"}
                      {mesmoNumero(c) ? " · mesmo número da conversa" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
