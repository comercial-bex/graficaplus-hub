import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IlustracaoDoTipo } from "@/components/orcamento/ilustracoes-de-tipo";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import {
  fraseDoPlano,
  planoDeRenomear,
  SEM_FAMILIA,
  type FamiliaDaLista,
} from "@/domain/catalogo/familias-da-lista";

/**
 * A coluna de famílias da lista de produtos, como no Custeio do Holdprint:
 * desenho, nome e quantidade; a escolhida fica marcada. No celular vira uma
 * fila que rola de lado, para a lista de produtos continuar logo abaixo.
 */
export function FamiliasDaLista({
  familias,
  escolhida,
  total,
  aoEscolher,
}: {
  familias: readonly FamiliaDaLista[];
  escolhida: string | null;
  total: number;
  aoEscolher: (familia: string | null) => void;
}) {
  const classe = (ativa: boolean) =>
    cn(
      "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm md:w-full",
      ativa ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
    );
  return (
    <nav
      aria-label="Famílias de produtos"
      data-testid="familias-da-lista"
      className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
    >
      <button type="button" className={classe(escolhida === null)} aria-pressed={escolhida === null} onClick={() => aoEscolher(null)}>
        <span className="flex-1">Todas as famílias</span>
        <span className="text-xs text-muted-foreground">{total}</span>
      </button>
      {familias.map((f) => (
        <button
          key={f.nome}
          type="button"
          className={classe(escolhida === f.nome)}
          aria-pressed={escolhida === f.nome}
          onClick={() => aoEscolher(escolhida === f.nome ? null : f.nome)}
        >
          <IlustracaoDoTipo chave={f.chave} tamanho={32} marcado={escolhida === f.nome} />
          <span className="flex-1 whitespace-nowrap md:whitespace-normal">{f.nome}</span>
          <span className="text-xs text-muted-foreground">{f.quantidade}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * "Editar famílias": renomear uma família muda todos os produtos dela; dar o
 * nome de outra junta as duas. A frase diz quantos produtos mudam antes de
 * confirmar, e a gravação pede as linhas de volta para não "salvar" em silêncio.
 */
export function EditarFamilias({
  aberto,
  aoFechar,
  familias,
}: {
  aberto: boolean;
  aoFechar: () => void;
  familias: readonly FamiliaDaLista[];
}) {
  const qc = useQueryClient();
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const comNome = useMemo(() => familias.filter((f) => f.familia !== null), [familias]);
  const plano = planoDeRenomear(de, para, familias);

  const renomear = useMutation({
    mutationFn: async () => {
      if (!plano.ok) throw new Error(plano.erro);
      const { data, error } = await supabase
        .from("produtos")
        .update({ familia: plano.para } as never)
        .eq("familia", plano.de)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("Nada foi gravado: seu perfil não pode alterar o cadastro dos produtos.");
      return data.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto mudou de família." : `${n} produtos mudaram de família.`);
      void qc.invalidateQueries({ queryKey: ["produtos"] });
      setDe("");
      setPara("");
      aoFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar famílias</DialogTitle>
          <DialogDescription>
            Renomear muda todos os produtos da família de uma vez. Dar o nome de outra família junta as duas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="familia-de">Família</Label>
            <Select value={de} onValueChange={setDe}>
              <SelectTrigger id="familia-de" aria-label="Família que vai mudar">
                <SelectValue placeholder="Escolha a família" />
              </SelectTrigger>
              <SelectContent>
                {comNome.map((f) => (
                  <SelectItem key={f.nome} value={f.nome}>
                    {f.nome} ({f.quantidade})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="familia-para">Novo nome</Label>
            <Input
              id="familia-para"
              value={para}
              list="familias-existentes"
              placeholder="Ex.: Lonas"
              onChange={(e) => setPara(e.target.value)}
            />
            <datalist id="familias-existentes">
              {comNome.map((f) => (
                <option key={f.nome} value={f.nome} />
              ))}
            </datalist>
          </div>
          {(de || para) && (
            <p className={cn("text-sm", plano.ok ? "text-muted-foreground" : "text-destructive")} data-testid="plano-da-familia">
              {fraseDoPlano(plano)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Produto sem família aparece em "{SEM_FAMILIA}"; para dar família a ele, abra a pasta do produto.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={!plano.ok || renomear.isPending} onClick={() => renomear.mutate()}>
            {renomear.isPending ? "Gravando..." : "Renomear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
