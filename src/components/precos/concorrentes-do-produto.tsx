import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CONCORRENTES } from "@/domain/precos/tabela-de-precos";
import { brl, ROTULO_DO_TIPO, type Concorrente, type Produto, type TipoDePreco } from "./tipos";

/** Anotar e remover o preço de até 3 concorrentes de cada tipo (venda final ou terceirizado). */
export function ConcorrentesDoProduto({ produto, atuais }: { produto: Produto; atuais: Concorrente[] }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [fonte, setFonte] = useState("");
  const [tipo, setTipo] = useState<TipoDePreco>("parceiro");

  const invalidar = () => qc.invalidateQueries({ queryKey: ["tabela-precos", "concorrentes"] });

  const adicionar = useMutation({
    mutationFn: async () => {
      const valor = Number(preco.replace(",", "."));
      if (!nome.trim()) throw new Error("Diga o nome do concorrente.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o preço do concorrente.");
      const { error } = await (supabase as any).from("produto_concorrentes").insert({
        produto_id: produto.id,
        concorrente: nome.trim(),
        preco: valor,
        tipo_preco: tipo,
        fonte: fonte.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNome("");
      setPreco("");
      setFonte("");
      void invalidar();
      toast.success("Concorrente anotado");
    },
    onError: (e) => toast.error(/duplicate|unique/i.test(String((e as Error).message)) ? "Esse concorrente já está anotado neste produto." : mensagemErro(e)),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("produto_concorrentes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void invalidar();
      toast.success("Removido");
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const cheio = atuais.filter((c) => c.tipo_preco === tipo).length >= MAX_CONCORRENTES;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Preço praticado por {produto.unidade}. Até {MAX_CONCORRENTES} de cada tipo. Anote onde viu (site, orçamento, loja) para saber a data e a origem depois.
      </p>
      <ul className="space-y-1.5">
        {atuais.length === 0 && <li className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">Nenhum concorrente anotado ainda.</li>}
        {atuais.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
            <div className="min-w-0">
              <strong>{c.concorrente}</strong> <span className="font-mono">{brl(c.preco)}</span>{" "}
              <span className="text-xs text-muted-foreground">({ROTULO_DO_TIPO[c.tipo_preco]})</span>
              <div className="truncate text-xs text-muted-foreground">
                {[c.fonte, new Date(c.coletado_em + "T12:00:00").toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <Button size="icon" variant="ghost" aria-label={`Remover ${c.concorrente}`} onClick={() => remover.mutate(c.id)} disabled={remover.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="inline-flex w-full overflow-hidden rounded-md border border-border" role="group" aria-label="Tipo do preço">
        {(["parceiro", "final"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tipo === t}
            onClick={() => setTipo(t)}
            className={`flex-1 px-3 py-1.5 text-xs ${tipo === t ? "bg-primary/15 font-semibold" : "text-muted-foreground hover:bg-muted"}`}
          >
            Preço de {ROTULO_DO_TIPO[t]}
          </button>
        ))}
      </div>
      {cheio ? (
        <p className="text-xs text-muted-foreground">Já são {MAX_CONCORRENTES} de {ROTULO_DO_TIPO[tipo]}. Remova um para anotar outro.</p>
      ) : (
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            adicionar.mutate();
          }}
        >
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Concorrente" aria-label="Nome do concorrente" />
          <Input value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="Preço (R$)" inputMode="decimal" aria-label="Preço do concorrente" />
          <Input className="col-span-2" value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="Onde viu (opcional)" aria-label="Fonte do preço" />
          <Button type="submit" className="col-span-2" disabled={adicionar.isPending}>
            Anotar concorrente
          </Button>
        </form>
      )}
    </div>
  );
}
