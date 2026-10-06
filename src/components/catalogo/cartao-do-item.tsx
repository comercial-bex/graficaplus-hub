import { useState } from "react";
import { AlertTriangle, Camera, FileQuestion, ImageOff, Package, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dica } from "@/components/bex/Dica";
import { cn } from "@/lib/utils";
import { dicaAcao } from "@/lib/dicas";
import { PRECO_POR, ROTULO_DA_MODALIDADE } from "@/domain/catalogo/modalidades";
import {
  MOTIVO_SOB_CONSULTA,
  ORIGEM_DO_PRECO,
  emReais,
  precoEmReais,
} from "@/domain/catalogo/preco-de-venda";
import { quantidadeParaCliente } from "@/domain/catalogo/quantidade";
import type { FotoDoAcervo, ItemDoCatalogo, PrecoDaOpcao } from "@/domain/catalogo/itens";
import { enderecoDaFoto } from "@/lib/catalogo-publico";

export type PermissoesDoCatalogo = {
  /** catalogo.manage: foto, link, cadastro. */
  gerenciar: boolean;
  /** Vê preço de venda (comercial ou financeiro). */
  vePreco: boolean;
  /** Vê custo e margem (financeiro). */
  veCusto: boolean;
  /** Pode pôr item em orçamento (orcamentos.update + vê preço). */
  orcar: boolean;
};

/**
 * Um item do catálogo na tela da equipe. O que aparece segue o nível de quem
 * olha — e quem decide é o servidor: `catalogo_precos` só manda custo e margem
 * para quem vê o financeiro, e só manda preço para quem vê preço.
 *   operacional  foto, nome, especificação, código BX, mínimo e múltiplo
 *   comercial    + preço de venda de cada opção (ou "sob consulta" e o motivo)
 *   financeiro   + custo, margem e de onde veio a regra
 */
export function CartaoDoItem({
  item,
  foto,
  secao,
  precos,
  permissoes,
  selecionavel,
  selecionado,
  onSelecionar,
  onOrcar,
  onFoto,
  onDuvida,
}: {
  item: ItemDoCatalogo;
  foto: FotoDoAcervo | null;
  secao: string | null;
  precos: PrecoDaOpcao[] | null;
  permissoes: PermissoesDoCatalogo;
  selecionavel: boolean;
  selecionado: boolean;
  onSelecionar: (v: boolean) => void;
  onOrcar: () => void;
  onFoto: () => void;
  onDuvida: () => void;
}) {
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const url = enderecoDaFoto(foto);
  const temPreco = (precos ?? []).some((p) => p.preco != null);

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-card",
        selecionado ? "border-primary ring-1 ring-primary" : "border-border",
        item.situacao === "fora_da_tabela" && "opacity-80",
      )}
    >
      <div className="relative aspect-[4/3] bg-white">
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt={item.nome}
            loading="lazy"
            decoding="async"
            onError={() => setFotoFalhou(true)}
            className="h-full w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/40 text-xs text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            {item.tem_foto ? "A foto não carregou" : "Sem foto — o cliente não vê este item"}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
          {item.codigo_bex}
        </span>
        {selecionavel && (
          <label className="absolute right-2 top-2 flex h-9 items-center gap-1.5 rounded bg-background/90 px-2 text-xs">
            <Checkbox
              checked={selecionado}
              disabled={!item.tem_foto}
              onCheckedChange={(v) => onSelecionar(v === true)}
              aria-label={`Escolher ${item.codigo_bex} para o link`}
            />
            {item.tem_foto ? "No link" : "Sem foto"}
          </label>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold leading-snug">{item.nome}</h3>
          <p className="text-[11px] text-muted-foreground" title={item.descricao}>
            Fornecedor: <span className="font-mono">{item.codigo_fornecedor}</span>
            {secao ? ` · ${secao}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {item.situacao === "fora_da_tabela" && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
              Fora da tabela
            </Badge>
          )}
          {item.em_duvida && (
            <Dica texto={item.duvida}>
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 h-3 w-3" /> Unidade em dúvida
              </Badge>
            </Dica>
          )}
          {item.foto_conferir && (
            <Badge variant="outline" className="border-sky-500/50 text-sky-700 dark:text-sky-300">
              Foto a conferir
            </Badge>
          )}
          {item.e_embalagem && (
            <Badge variant="outline">
              <Package className="mr-1 h-3 w-3" /> Embalagem
            </Badge>
          )}
        </div>

        {item.especificacao && <p className="line-clamp-3 text-xs text-muted-foreground">{item.especificacao}</p>}
        {item.dimensoes && <p className="text-xs text-muted-foreground">Medidas: {item.dimensoes}</p>}

        <ul className="mt-auto space-y-1.5 pt-1">
          {item.modalidades.length === 0 && (
            <li className="text-xs text-muted-foreground">Sem opção de preço na tabela do fornecedor.</li>
          )}
          {item.modalidades.map((m) => {
            const p = precos?.find((x) => x.modalidade === m.modalidade) ?? null;
            const regra = quantidadeParaCliente({
              quantidadeMinima: m.quantidade_minima,
              multiplo: m.multiplo,
              faixa: m.faixa,
            });
            return (
              <li key={m.modalidade} className="rounded-md border border-border/70 px-2 py-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {ROTULO_DA_MODALIDADE[m.modalidade]}
                    {m.rotulo_inferido && (
                      <Dica texto="A tabela do fornecedor não rotulou esta coluna; o nome foi deduzido. Confirme ao fazer o pedido.">
                        <span className="ml-1 cursor-help text-amber-600">*</span>
                      </Dica>
                    )}
                  </span>
                  {permissoes.vePreco && (
                    <span className={cn("shrink-0 text-right", p?.preco != null ? "font-semibold" : "text-muted-foreground")}>
                      {p?.preco != null ? precoEmReais(p.preco) : "Sob consulta"}
                    </span>
                  )}
                </div>
                {regra && <p className="text-muted-foreground">{regra}</p>}
                {permissoes.vePreco && p?.preco != null && (
                  <p className="text-muted-foreground">{PRECO_POR[item.unidade_preco]}</p>
                )}
                {permissoes.vePreco && p?.preco == null && p?.motivo && (
                  <p className="text-muted-foreground">{MOTIVO_SOB_CONSULTA[p.motivo]}</p>
                )}
                {permissoes.veCusto && p && (
                  <p className="text-muted-foreground">
                    Custo {emReais(p.custo ?? null)}
                    {p.adicional_por_cor != null ? ` · cor adicional ${emReais(p.adicional_por_cor)}` : ""}
                    {p.regra ? ` · ${ORIGEM_DO_PRECO[p.regra]}` : ""}
                    {p.regra && p.regra !== "preco_fixo" && p.margem_pct != null ? ` (${p.margem_pct}%)` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-2 pt-1">
          {permissoes.orcar && (
            <Dica texto={temPreco ? dicaAcao("/catalogos", "orcar") : "Sem preço de venda: o item está sob consulta."}>
              <Button size="sm" className="h-10 md:h-8" disabled={!temPreco} onClick={onOrcar}>
                <ShoppingCart className="mr-1 h-4 w-4" /> Orçamento
              </Button>
            </Dica>
          )}
          {permissoes.gerenciar && (
            <Dica texto={dicaAcao("/catalogos", "foto")}>
              <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={onFoto}>
                <Camera className="mr-1 h-4 w-4" /> Foto
              </Button>
            </Dica>
          )}
          {permissoes.gerenciar && permissoes.veCusto && item.em_duvida && (
            <Dica texto={dicaAcao("/catalogos", "duvida")}>
              <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={onDuvida}>
                <FileQuestion className="mr-1 h-4 w-4" /> Resolver dúvida
              </Button>
            </Dica>
          )}
        </div>
      </div>
    </article>
  );
}
