import { useEffect, useMemo, useState } from "react";
import { ImageOff, Layers, ShoppingCart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PRECO_POR } from "@/domain/catalogo/modalidades";
import { precoDaPeca, precoEmReais, arredondar } from "@/domain/catalogo/preco-de-venda";
import {
  conferirQuantidade,
  quantidadeInicial,
  quantidadeParaCliente,
} from "@/domain/catalogo/quantidade";
import { ROTULO_DA_CATEGORIA } from "@/domain/catalogo/categorias-da-loja";
import {
  alternativas,
  combinaCom,
  opcaoPadrao,
  type ItemDaLoja,
  type OpcaoDaLoja,
} from "@/domain/catalogo/loja";
import { enderecoDaFoto } from "@/lib/catalogo-publico";
import { StepperQuantidade } from "@/components/catalogo/loja/stepper-quantidade";
import { MiniaturaDaLoja } from "@/components/catalogo/loja/cartao-da-loja";

/**
 * A ficha do produto: foto grande, especificação, as opções de gravação com
 * o preço de cada uma (ou "sob consulta"), o seletor de quantidade, o total e
 * "Adicionar ao carrinho". Embaixo, as sugestões — "Alternativas" (mesma
 * categoria, preço parecido) e "Combina com" (categorias que vão juntas) —
 * que abrem outra ficha no lugar desta.
 */
export function ProdutoDaLoja({
  item,
  itens,
  onOpenChange,
  onAbrirOutro,
  onAdicionar,
}: {
  item: ItemDaLoja | null;
  itens: ItemDaLoja[];
  onOpenChange: (aberto: boolean) => void;
  onAbrirOutro: (item: ItemDaLoja) => void;
  onAdicionar: (item: ItemDaLoja, opcao: OpcaoDaLoja, quantidade: number) => void;
}) {
  const [modalidade, setModalidade] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [fotoFalhou, setFotoFalhou] = useState(false);

  const codigo = item?.codigo ?? null;
  useEffect(() => {
    if (!item) return;
    const padrao = opcaoPadrao(item);
    setModalidade(padrao?.modalidade ?? null);
    setQuantidade(
      padrao
        ? quantidadeInicial({
            quantidadeMinima: padrao.quantidade_minima,
            multiplo: padrao.multiplo,
          })
        : 1,
    );
    setFotoFalhou(false);
    // Recomeça só quando muda o PRODUTO, não a cada novo render da lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  const opcao = item?.opcoes.find((o) => o.modalidade === modalidade) ?? null;
  const regra = opcao
    ? {
        quantidadeMinima: opcao.quantidade_minima,
        multiplo: opcao.multiplo,
        faixa: opcao.faixa,
        faixaMax: opcao.faixa_max,
      }
    : null;
  const conferencia = opcao && regra ? conferirQuantidade(quantidade, regra, opcao.rotulo) : null;
  const unitario =
    item && opcao?.preco != null ? precoDaPeca(opcao.preco, item.unidade_preco) : null;
  const total = unitario != null && conferencia?.ok ? arredondar(unitario * quantidade, 2) : null;

  const parecidos = useMemo(() => (item ? alternativas(item, itens) : []), [item, itens]);
  const combinam = useMemo(() => (item ? combinaCom(item, itens) : []), [item, itens]);
  const url = enderecoDaFoto(item?.foto);

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
        {item && (
          <div className="flex min-h-full flex-col">
            <div className="relative aspect-square w-full overflow-hidden bg-white sm:aspect-[4/3]">
              {url && !fotoFalhou ? (
                <img
                  src={url}
                  alt={item.nome}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setFotoFalhou(true)}
                  className="absolute inset-0 h-full w-full object-contain p-4"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                  <ImageOff className="h-6 w-6" /> A foto não carregou
                </div>
              )}
              <span className="absolute left-3 top-3 rounded bg-background/90 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide">
                {item.codigo}
              </span>
            </div>

            <div className="space-y-4 p-4">
              <SheetHeader className="space-y-1 text-left">
                <SheetTitle className="text-lg leading-snug">{item.nome}</SheetTitle>
                <SheetDescription>
                  {ROTULO_DA_CATEGORIA[item.categoria]}
                  {item.secao ? ` · ${item.secao}` : ""}
                </SheetDescription>
              </SheetHeader>

              {item.especificacao && (
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {item.especificacao}
                </p>
              )}
              {item.dimensoes && (
                <p className="text-sm text-muted-foreground">Medidas: {item.dimensoes}</p>
              )}

              {item.opcoes.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Preço sob consulta: peça a cotação e a Bex Print confirma o valor.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label>Opção</Label>
                  <RadioGroup
                    value={modalidade ?? ""}
                    onValueChange={(v) => {
                      const o = item.opcoes.find((x) => x.modalidade === v);
                      setModalidade(v);
                      if (o)
                        setQuantidade(
                          quantidadeInicial({
                            quantidadeMinima: o.quantidade_minima,
                            multiplo: o.multiplo,
                          }),
                        );
                    }}
                  >
                    {item.opcoes.map((o) => {
                      const texto = quantidadeParaCliente({
                        quantidadeMinima: o.quantidade_minima,
                        multiplo: o.multiplo,
                        faixa: o.faixa,
                      });
                      return (
                        <label
                          key={o.modalidade}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm",
                            modalidade === o.modalidade
                              ? "border-primary bg-primary/10"
                              : "border-border",
                          )}
                        >
                          <RadioGroupItem value={o.modalidade} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{o.rotulo}</span>
                            {texto && (
                              <span className="block text-xs text-muted-foreground">{texto}</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-right font-semibold",
                              o.preco == null && "text-muted-foreground",
                            )}
                          >
                            {o.preco != null ? precoEmReais(o.preco) : "Sob consulta"}
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                  {opcao?.preco != null && (
                    <p className="text-xs text-muted-foreground">
                      Preço {PRECO_POR[item.unidade_preco]}.
                    </p>
                  )}
                </div>
              )}

              {opcao && regra && (
                <div className="space-y-2">
                  <Label>Quantidade (peças)</Label>
                  <div className="flex flex-wrap items-start gap-3">
                    <StepperQuantidade
                      valor={quantidade}
                      regra={regra}
                      rotulo={opcao.rotulo}
                      onChange={setQuantidade}
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      {total != null && unitario != null ? (
                        <p>
                          {quantidade} × {precoEmReais(unitario)} ={" "}
                          <span className="font-bold">{precoEmReais(total)}</span>
                        </p>
                      ) : opcao.preco == null ? (
                        <p className="text-muted-foreground">Valor sob consulta.</p>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="h-12 w-full text-base"
                    disabled={!conferencia?.ok}
                    onClick={() => onAdicionar(item, opcao, quantidade)}
                  >
                    <ShoppingCart className="mr-2 h-5 w-5" /> Adicionar ao carrinho
                  </Button>
                </div>
              )}

              {parecidos.length > 0 && (
                <Faixa titulo="Alternativas" icone={<Layers className="h-4 w-4" />}>
                  {parecidos.map((p) => (
                    <MiniaturaDaLoja key={p.codigo} item={p} onAbrir={() => onAbrirOutro(p)} />
                  ))}
                </Faixa>
              )}
              {combinam.length > 0 && (
                <Faixa titulo="Combina com" icone={<Sparkles className="h-4 w-4" />}>
                  {combinam.map((p) => (
                    <MiniaturaDaLoja key={p.codigo} item={p} onAbrir={() => onAbrirOutro(p)} />
                  ))}
                </Faixa>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function Faixa({
  titulo,
  icone,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {icone} {titulo}
      </h3>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">{children}</div>
    </section>
  );
}
