import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Lock, ShieldCheck, User } from "lucide-react";
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
import { confirmarPrecoDoOrcamento } from "@/lib/api/orcamento-preco.functions";

export type ModoDePreco = "cliente_final" | "parceiro";

/**
 * "Para quem é o preço" (22/10/2026): cliente final (tabela) ou parceiro
 * (terceirizado). Parceiro troca os itens do catálogo pelo preço de parceiro e
 * pede a senha de quem está orçando; fica gravado quem confirmou e quando. O
 * cliente que é revendedor abre com a sugestão de trocar.
 */
export function PrecoDoOrcamento({
  orcamentoId,
  modo,
  confirmadoPor,
  confirmadoEm,
  clienteRevendedor,
  parceiroCadastrado = false,
  nivelDoParceiro = null,
  descontoDoParceiro = null,
  podeEditar,
}: {
  orcamentoId: string;
  modo: ModoDePreco;
  confirmadoPor: string | null;
  confirmadoEm: string | null;
  clienteRevendedor: boolean;
  /** O cliente tem cadastro de parceiro ativo: o preço é do programa e entra sem senha. */
  parceiroCadastrado?: boolean;
  nivelDoParceiro?: string | null;
  descontoDoParceiro?: number | null;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const confirmar = useServerFn(confirmarPrecoDoOrcamento);
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [senha, setSenha] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const quem = useQuery({
    queryKey: ["usuario-nome", confirmadoPor],
    enabled: !!confirmadoPor,
    queryFn: async () => {
      const { data } = await supabase.from("usuarios").select("nome").eq("id", confirmadoPor as string).maybeSingle();
      return (data as { nome: string } | null)?.nome ?? null;
    },
  });

  async function aplicar(novo: ModoDePreco, senhaDigitada?: string) {
    if (trabalhando) return;
    setTrabalhando(true);
    setErro(null);
    try {
      const r = await confirmar({ data: { orcamentoId, modo: novo, senha: senhaDigitada } });
      const aviso =
        r.itens_sem_preco > 0
          ? ` ${r.itens_sem_preco} item(ns) ficaram como estavam (sem produto ou sem preço de parceiro).`
          : "";
      toast.success(
        novo === "parceiro"
          ? `Preço de parceiro confirmado em ${r.itens_repreciados} item(ns).${aviso}`
          : `Voltou ao preço de tabela em ${r.itens_repreciados} item(ns).${aviso}`,
      );
      setPedindoSenha(false);
      setSenha("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orcamento", orcamentoId] }),
        qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] }),
      ]);
    } catch (e) {
      const msg = mensagemErro(e);
      if (novo === "parceiro" && pedindoSenha) setErro(msg);
      else toast.error(msg);
    } finally {
      setTrabalhando(false);
    }
  }

  const botao = (valor: ModoDePreco, rotulo: string, Icone: typeof User) => (
    <button
      type="button"
      aria-pressed={modo === valor}
      disabled={!podeEditar || trabalhando}
      onClick={() => {
        if (modo === valor) return;
        if (valor === "parceiro" && parceiroCadastrado) void aplicar("parceiro");
        else if (valor === "parceiro") {
          setSenha("");
          setErro(null);
          setPedindoSenha(true);
        } else void aplicar("cliente_final");
      }}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        modo === valor ? "bg-primary/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden />
      {rotulo}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Para quem é o preço" className="inline-flex overflow-hidden rounded-md border border-border">
        {botao("cliente_final", "Cliente final", User)}
        <span className="w-px bg-border" aria-hidden />
        {botao("parceiro", "Parceiro (terceirizado)", Building2)}
      </div>
      {modo === "parceiro" && parceiroCadastrado && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
          Tabela de parceiro{nivelDoParceiro ? ` · ${nivelDoParceiro}` : ""}
          {descontoDoParceiro != null ? ` · ${Number(descontoDoParceiro).toLocaleString("pt-BR")}% abaixo do balcão` : ""}
          {" "}(automático)
        </span>
      )}
      {modo === "parceiro" && !parceiroCadastrado && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
          Confirmado{quem.data ? ` por ${quem.data.split(" ")[0]}` : ""}
          {confirmadoEm
            ? ` em ${new Date(confirmadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
      )}
      {modo === "cliente_final" && clienteRevendedor && podeEditar && (
        <span className="text-xs text-warning">
          {parceiroCadastrado
            ? "Este cliente é parceiro: use o preço de parceiro."
            : "Este cliente está marcado como revendedor, mas não tem cadastro de parceiro: a tabela por nível não se aplica. Cadastre em Parceiros."}
        </span>
      )}

      <Dialog open={pedindoSenha} onOpenChange={(v) => !trabalhando && setPedindoSenha(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar preço de parceiro</DialogTitle>
            <DialogDescription>
              Os itens do catálogo passam para o preço de parceiro, que é menor que o de tabela. Confirme com a sua
              senha: fica registrado quem confirmou e quando.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!senha.trim()) return setErro("Digite a sua senha.");
              void aplicar("parceiro", senha);
            }}
          >
            <Label htmlFor="preco-parceiro-senha" className="flex items-center gap-1">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Sua senha do Bex Print
            </Label>
            <Input
              id="preco-parceiro-senha"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value);
                setErro(null);
              }}
              aria-invalid={!!erro}
              aria-describedby="preco-parceiro-erro"
            />
            <p id="preco-parceiro-erro" className="min-h-5 text-xs text-destructive" aria-live="polite">
              {erro}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPedindoSenha(false)} disabled={trabalhando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={trabalhando}>
                {trabalhando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {trabalhando ? "Conferindo…" : "Confirmar preço de parceiro"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
