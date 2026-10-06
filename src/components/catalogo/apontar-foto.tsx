import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ImageOff, Loader2, Search } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import { enderecoDaFoto } from "@/lib/catalogo-publico";
import { fotosParaApontar, type FotoDoAcervo, type ItemDoCatalogo } from "@/domain/catalogo/itens";
import { apontarFoto } from "@/components/catalogo/consultas";

/**
 * Apontar a foto de um item. A carga casou foto e item pela cor da descrição
 * e, na dúvida, deixou o item SEM foto (foto de outra cor no item seria pior:
 * o cliente pediria a caneta verde vendo uma vermelha). Aqui a pessoa escolhe
 * entre as fotos do mesmo código — e, se o catálogo imprimiu o código errado,
 * procura no acervo inteiro pela legenda.
 */
export function ApontarFotoDialog({
  item,
  fotos,
  onOpenChange,
  onApontada,
}: {
  item: ItemDoCatalogo | null;
  fotos: FotoDoAcervo[];
  onOpenChange: (aberto: boolean) => void;
  onApontada: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    setBusca("");
    setEscolhida(item?.foto_id ?? null);
  }, [item]);

  const { doCodigo, outras } = useMemo(
    () => (item ? fotosParaApontar(fotos, item, busca) : { doCodigo: [], outras: [] }),
    [fotos, item, busca],
  );

  async function gravar(fotoId: string | null) {
    if (!item) return;
    setGravando(true);
    try {
      await apontarFoto(item.id, fotoId);
      toast.success(fotoId ? `Foto de ${item.codigo_bex} gravada.` : `${item.codigo_bex} ficou sem foto.`);
      onApontada();
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Foto do item</DialogTitle>
          <DialogDescription>
            {item ? `${item.codigo_bex} · ${item.descricao}` : ""}. Escolha a foto que mostra ESTE item — cor e
            material. Item sem foto não aparece no link do cliente.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">
            Fotos do código {item?.codigo_fornecedor} ({doCodigo.length})
          </h3>
          {doCodigo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              O catálogo de fotos não tem foto com este código. Procure pela legenda abaixo ou suba a foto na aba
              Fotos (nome do arquivo = código do fornecedor).
            </p>
          ) : (
            <GradeDeFotos fotos={doCodigo} escolhida={escolhida} onEscolher={setEscolhida} />
          )}
        </section>

        <section className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar no acervo pela legenda (ex.: caneta verde metal)"
              className="h-11 pl-9"
            />
          </div>
          {busca.trim() && outras.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma outra foto com essa legenda.</p>
          )}
          {outras.length > 0 && <GradeDeFotos fotos={outras} escolhida={escolhida} onEscolher={setEscolhida} />}
        </section>

        <DialogFooter className="gap-2">
          {item?.foto_id && (
            <Button
              variant="outline"
              className="h-11 md:h-9 sm:mr-auto"
              disabled={gravando}
              onClick={() => void gravar(null)}
            >
              Tirar a foto
            </Button>
          )}
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={gravando || !escolhida || escolhida === item?.foto_id}
            onClick={() => void gravar(escolhida)}
          >
            {gravando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Usar esta foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GradeDeFotos({
  fotos,
  escolhida,
  onEscolher,
}: {
  fotos: FotoDoAcervo[];
  escolhida: string | null;
  onEscolher: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {fotos.map((f) => {
        const url = enderecoDaFoto(f);
        const marcada = escolhida === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onEscolher(f.id)}
            aria-pressed={marcada}
            className={cn(
              "relative flex flex-col overflow-hidden rounded-md border text-left",
              marcada ? "border-primary ring-2 ring-primary" : "border-border hover:border-foreground/40",
            )}
          >
            <span className="flex aspect-square items-center justify-center bg-white">
              {url ? (
                <img src={url} alt={f.legenda ?? ""} loading="lazy" className="h-full w-full object-contain p-1" />
              ) : (
                <ImageOff className="h-5 w-5 text-muted-foreground" />
              )}
            </span>
            <span className="line-clamp-2 p-1.5 text-[11px] leading-tight">{f.legenda ?? f.codigo_fornecedor}</span>
            {marcada && (
              <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
