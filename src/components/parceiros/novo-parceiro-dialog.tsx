import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { criarParceiro } from "@/lib/parceiro-api";
import { cn } from "@/lib/utils";
import { useEquipe, useNiveis } from "./dados";

type ClienteAchado = { id: string; nome: string; nome_fantasia: string | null; cidade: string | null };

/**
 * Transforma um cliente em parceiro.
 *
 * O parceiro nasce de um cliente que já existe: é pelo cadastro de cliente que as
 * compras dele contam para nível e meta (as OS saem no nome dele). Sem cliente,
 * não haveria como somar o que ele comprou.
 */
export function NovoParceiroDialog({
  aberto,
  onOpenChange,
  onCriado,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: (parceiroId: string) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const { data: niveis = [] } = useNiveis();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [cliente, setCliente] = useState<ClienteAchado | null>(null);
  const [responsavel, setResponsavel] = useState<string>("");
  const [nivel, setNivel] = useState<string>("automatico");
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setBusca("");
      setTermo("");
      setCliente(null);
      setResponsavel(user?.id ?? "");
      setNivel("automatico");
    }
  }, [aberto, user?.id]);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: achados = [], isFetching } = useQuery({
    queryKey: ["parceiros-busca-cliente", termo],
    enabled: aberto && termo.length >= 2,
    queryFn: async (): Promise<ClienteAchado[]> => {
      // vírgula e parênteses quebram o filtro `or` do PostgREST
      const limpo = termo.replace(/[,()]/g, " ");
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, nome_fantasia, cidade")
        .or(`nome.ilike.%${limpo}%,nome_fantasia.ilike.%${limpo}%`)
        .order("nome")
        .limit(15);
      if (error) throw error;
      return (data ?? []) as ClienteAchado[];
    },
  });

  async function criar() {
    if (!cliente) return;
    setCriando(true);
    try {
      const id = await criarParceiro({
        clienteId: cliente.id,
        responsavelId: responsavel || null,
        nivelFixoId: nivel === "automatico" ? null : nivel,
      });
      toast.success(`${cliente.nome_fantasia || cliente.nome} agora é parceiro. Falta dar o acesso ao painel.`);
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
      onOpenChange(false);
      onCriado(id);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível cadastrar o parceiro."));
    } finally {
      setCriando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo parceiro</DialogTitle>
          <DialogDescription>
            Escolha o cliente que vai revender. As compras dele contam para o nível e as metas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="busca-cliente">Cliente</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="busca-cliente"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setCliente(null);
              }}
              placeholder="Nome ou nome fantasia"
              className="pl-9"
              autoFocus
            />
          </div>
          {termo.length >= 2 && !cliente && (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {isFetching && achados.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Procurando…</p>
              ) : achados.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Nenhum cliente com esse nome. Cadastre o cliente antes em Clientes.
                </p>
              ) : (
                achados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCliente(c);
                      setBusca(c.nome_fantasia || c.nome);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-foreground/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.nome_fantasia || c.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.nome_fantasia ? c.nome : ""}
                        {c.cidade ? `${c.nome_fantasia ? " · " : ""}${c.cidade}` : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {cliente && (
            <p className={cn("flex items-center gap-1.5 text-sm text-[color:var(--bex-cyan)]")}>
              <Check className="h-4 w-4" /> {cliente.nome}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Atendente na gráfica</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {equipe.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Vira o vendedor dos pedidos dele.</p>
          </div>
          <div className="space-y-2">
            <Label>Nível inicial</Label>
            <Select value={nivel} onValueChange={setNivel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatico">Pelas compras (automático)</SelectItem>
                {niveis.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    Garantir no mínimo {n.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Garantido é piso: sobe se comprar mais.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={!cliente || !responsavel || criando}>
            {criando ? "Cadastrando…" : "Cadastrar parceiro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
