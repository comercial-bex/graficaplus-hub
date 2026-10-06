import { useState } from "react";
import { Check, ImageOff, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRECO_POR } from "@/domain/catalogo/modalidades";
import { precoEmReais } from "@/domain/catalogo/preco-de-venda";
import { quantidadeParaCliente } from "@/domain/catalogo/quantidade";
import type { ItemDaVitrine } from "@/domain/catalogo/vitrine";
import { enderecoDaFoto } from "@/lib/catalogo-publico";

/**
 * Um item na vitrine do cliente: foto, nome, especificação, código BX e o
 * preço de cada opção — ou "sob consulta", nunca R$ 0,00. Tocar numa opção
 * marca o item para o pedido de orçamento pelo WhatsApp.
 */
export function CartaoDaVitrine({
  item,
  escolhidas,
  onAlternar,
}: {
  item: ItemDaVitrine;
  /** Opções escolhidas deste item; `null` na lista = o item sem opção de preço. */
  escolhidas: (string | null)[];
  onAlternar: (opcao: string | null) => void;
}) {
  const [verTudo, setVerTudo] = useState(false);
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const url = enderecoDaFoto(item.foto);
  const longo = (item.especificacao?.length ?? 0) > 140;

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-square bg-white">
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt={item.nome}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFotoFalhou(true)}
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImageOff className="h-6 w-6" /> A foto não carregou
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide">
          {item.codigo}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold leading-snug">{item.nome}</h3>
        {item.especificacao && (
          <p className={cn("text-xs text-muted-foreground", !verTudo && longo && "line-clamp-3")}>
            {item.especificacao}
          </p>
        )}
        {longo && (
          <button
            type="button"
            onClick={() => setVerTudo((v) => !v)}
            className="self-start text-xs font-medium underline underline-offset-2"
          >
            {verTudo ? "Ver menos" : "Ver a especificação inteira"}
          </button>
        )}
        {item.dimensoes && <p className="text-xs text-muted-foreground">Medidas: {item.dimensoes}</p>}

        <div className="mt-auto space-y-1.5 pt-1">
          {item.opcoes.length === 0 ? (
            <BotaoDeOpcao
              marcada={escolhidas.includes(null)}
              onClick={() => onAlternar(null)}
              titulo="Preço sob consulta"
              detalhe={null}
              preco={null}
            />
          ) : (
            item.opcoes.map((o) => (
              <BotaoDeOpcao
                key={o.modalidade}
                marcada={escolhidas.includes(o.modalidade)}
                onClick={() => onAlternar(o.modalidade)}
                titulo={item.opcoes.length === 1 && o.modalidade === "valor_unico" ? "Preço" : o.rotulo}
                detalhe={quantidadeParaCliente({
                  quantidadeMinima: o.quantidade_minima,
                  multiplo: o.multiplo,
                  faixa: o.faixa,
                })}
                preco={o.preco == null ? null : `${precoEmReais(o.preco)} ${PRECO_POR[item.unidade_preco]}`}
              />
            ))
          )}
        </div>
      </div>
    </article>
  );
}

function BotaoDeOpcao({
  marcada,
  onClick,
  titulo,
  detalhe,
  preco,
}: {
  marcada: boolean;
  onClick: () => void;
  titulo: string;
  detalhe: string | null;
  preco: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcada}
      className={cn(
        "flex min-h-11 w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
        marcada ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
          marcada ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
        aria-hidden
      >
        {marcada ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{titulo}</span>
        {detalhe && <span className="block text-muted-foreground">{detalhe}</span>}
      </span>
      <span className={cn("shrink-0 text-right font-semibold", preco ? "" : "text-muted-foreground")}>
        {preco ?? "Sob consulta"}
      </span>
    </button>
  );
}
