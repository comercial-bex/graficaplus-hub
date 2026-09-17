/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { mensagemErro } from "@/lib/erros";
import { CHAVE_PAINEL } from "@/lib/parceiro-api";

/**
 * Começa um orçamento pedindo só o que o banco exige: para quem é e do que se
 * trata. Item, medida e preço vêm na tela seguinte — pedir tudo de uma vez num
 * diálogo no celular faz a pessoa desistir antes de começar.
 */
export function NovoOrcamento({
  parceiroId,
  className,
  rotulo = "Novo orçamento",
}: {
  parceiroId: string;
  className?: string;
  rotulo?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [cliente, setCliente] = useState("");
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!cliente.trim() || !titulo.trim()) return;
    setCriando(true);
    const { data, error } = await (supabase as any)
      .from("parceiro_orcamentos")
      .insert({ parceiro_id: parceiroId, cliente_nome: cliente.trim(), titulo: titulo.trim() })
      .select("id")
      .single();
    setCriando(false);
    if (error || !data) {
      toast.error(mensagemErro(error, "Não foi possível criar o orçamento."));
      return;
    }
    qc.invalidateQueries({ queryKey: ["parceiro-orcamentos"] });
    qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    setAberto(false);
    setCliente("");
    setTitulo("");
    navigate({ to: "/parceiro/orcamentos/$id", params: { id: data.id } });
  }

  return (
    <>
      <Button onClick={() => setAberto(true)} className={className}>
        <Plus className="mr-1 h-4 w-4" />
        {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <form onSubmit={criar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo orçamento</DialogTitle>
              <DialogDescription>
                Para quem é e do que se trata. Os itens você coloca em seguida.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="novo-cliente">Nome do cliente</Label>
              <Input
                id="novo-cliente"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Ex.: Padaria Pão Quente"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="novo-titulo">Do que se trata</Label>
              <Input
                id="novo-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: Fachada e adesivos de vitrine"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={criando || !cliente.trim() || !titulo.trim()}>
                {criando ? "Criando…" : "Criar e colocar itens"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
