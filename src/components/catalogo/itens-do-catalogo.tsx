import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Link2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_FILTRO,
  filtrarItens,
  semPrecoDeVenda,
  type FiltroDoCatalogo,
  type FotoDoAcervo,
  type ItemDoCatalogo,
  type PrecosDoCatalogo,
  type SecaoDoCatalogo,
} from "@/domain/catalogo/itens";
import { CartaoDoItem, type PermissoesDoCatalogo } from "@/components/catalogo/cartao-do-item";
import { AdicionarAoOrcamentoDialog } from "@/components/catalogo/adicionar-ao-orcamento";
import { ApontarFotoDialog } from "@/components/catalogo/apontar-foto";
import { ResolverDuvidaDialog } from "@/components/catalogo/resolver-duvida";
import { GerarLinkDialog } from "@/components/catalogo/links-do-catalogo";

const TODAS = "__todas__";
const PASSO = 48;

/**
 * A grade de itens do catálogo, com busca, seção e os filtros de trabalho:
 * sem foto, foto a conferir, sem preço de venda, unidade em dúvida, fora da
 * tabela. Desenha de 48 em 48 — são 933 itens com foto na LUGA, e o celular
 * da equipe não precisa de 933 imagens de uma vez.
 */
export function ItensDoCatalogo({
  catalogoId,
  itens,
  secoes,
  fotos,
  precos,
  permissoes,
  filtroInicial,
  onMudou,
}: {
  catalogoId: string;
  itens: ItemDoCatalogo[];
  secoes: SecaoDoCatalogo[];
  fotos: FotoDoAcervo[];
  precos: PrecosDoCatalogo | null;
  permissoes: PermissoesDoCatalogo;
  filtroInicial: FiltroDoCatalogo;
  onMudou: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [secaoId, setSecaoId] = useState<string>(TODAS);
  const [filtro, setFiltro] = useState<FiltroDoCatalogo>(filtroInicial);
  const [limite, setLimite] = useState(PASSO);
  const [escolhendo, setEscolhendo] = useState(false);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [orcando, setOrcando] = useState<ItemDoCatalogo | null>(null);
  const [apontando, setApontando] = useState<ItemDoCatalogo | null>(null);
  const [resolvendo, setResolvendo] = useState<ItemDoCatalogo | null>(null);
  const [gerandoLink, setGerandoLink] = useState(false);

  useEffect(() => setFiltro(filtroInicial), [filtroInicial]);
  useEffect(() => setLimite(PASSO), [busca, secaoId, filtro]);

  const fotoPorId = useMemo(() => new Map(fotos.map((f) => [f.id, f])), [fotos]);
  const secaoPorId = useMemo(() => new Map(secoes.map((s) => [s.id, s.titulo])), [secoes]);

  const filtros: FiltroDoCatalogo[] = [
    "todos",
    "com_foto",
    "sem_foto",
    "foto_a_conferir",
    ...(precos ? (["sem_preco"] as FiltroDoCatalogo[]) : []),
    "em_duvida",
    "fora_da_tabela",
  ];
  const contagem = useMemo(() => {
    const c: Record<FiltroDoCatalogo, number> = {
      todos: itens.length,
      com_foto: 0,
      sem_foto: 0,
      foto_a_conferir: 0,
      sem_preco: 0,
      em_duvida: 0,
      fora_da_tabela: 0,
    };
    for (const i of itens) {
      if (i.tem_foto) c.com_foto++;
      else c.sem_foto++;
      if (i.foto_conferir) c.foto_a_conferir++;
      if (precos && semPrecoDeVenda(i, precos)) c.sem_preco++;
      if (i.em_duvida) c.em_duvida++;
      if (i.situacao === "fora_da_tabela") c.fora_da_tabela++;
    }
    return c;
  }, [itens, precos]);

  const visiveis = useMemo(
    () => filtrarItens(itens, { busca, secaoId: secaoId === TODAS ? null : secaoId, filtro }, precos),
    [itens, busca, secaoId, filtro, precos],
  );
  const visiveisComFoto = visiveis.filter((i) => i.tem_foto);

  function alternar(id: string, v: boolean) {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (v) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, código BX ou código do fornecedor"
            className="h-11 pl-9"
            aria-label="Buscar itens"
          />
        </div>
        <Select value={secaoId} onValueChange={setSecaoId}>
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as seções</SelectItem>
            {secoes.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar itens">
        {filtros.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filtro === f ? "default" : "outline"}
            className="h-11 md:h-8"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
          >
            {ROTULO_DO_FILTRO[f]} ({contagem[f]})
          </Button>
        ))}
      </div>

      {permissoes.gerenciar && (
        <div className="flex flex-wrap items-center gap-2">
          {escolhendo ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setEscolhidos(new Set([...escolhidos, ...visiveisComFoto.map((i) => i.id)]))}
              >
                <CheckSquare className="mr-1 h-4 w-4" /> Marcar os {visiveisComFoto.length} com foto desta lista
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 md:h-8"
                onClick={() => {
                  setEscolhendo(false);
                  setEscolhidos(new Set());
                }}
              >
                <X className="mr-1 h-4 w-4" /> Sair da escolha
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setEscolhendo(true)}>
              <Link2 className="mr-1 h-4 w-4" /> Escolher itens para o link do cliente
            </Button>
          )}
        </div>
      )}

      {visiveis.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {itens.length === 0
              ? "Este catálogo ainda não tem itens. Quem gerencia o catálogo carrega a planilha na aba Planilha."
              : "Nenhum item com esta busca e este filtro."}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {visiveis.length === itens.length ? `${itens.length} itens` : `${visiveis.length} de ${itens.length} itens`}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visiveis.slice(0, limite).map((item) => (
              <CartaoDoItem
                key={item.id}
                item={item}
                foto={item.foto_id ? (fotoPorId.get(item.foto_id) ?? null) : null}
                secao={item.secao_id ? (secaoPorId.get(item.secao_id) ?? null) : null}
                precos={precos?.precos[item.id] ?? null}
                permissoes={permissoes}
                selecionavel={escolhendo}
                selecionado={escolhidos.has(item.id)}
                onSelecionar={(v) => alternar(item.id, v)}
                onOrcar={() => setOrcando(item)}
                onFoto={() => setApontando(item)}
                onDuvida={() => setResolvendo(item)}
              />
            ))}
          </div>
          {visiveis.length > limite && (
            <div className="flex justify-center">
              <Button variant="outline" className="h-11" onClick={() => setLimite((l) => l + PASSO)}>
                Mostrar mais ({visiveis.length - limite} restantes)
              </Button>
            </div>
          )}
        </>
      )}

      {escolhendo && escolhidos.size > 0 && (
        <div
          className={cn(
            "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6",
          )}
        >
          <p className="flex-1 text-sm font-medium">{escolhidos.size} itens escolhidos</p>
          <Button variant="ghost" className="h-11 md:h-9" onClick={() => setEscolhidos(new Set())}>
            Limpar
          </Button>
          <Button className="h-11 md:h-9" onClick={() => setGerandoLink(true)}>
            <Link2 className="mr-1 h-4 w-4" /> Gerar link
          </Button>
        </div>
      )}

      <AdicionarAoOrcamentoDialog
        item={orcando}
        precos={orcando ? (precos?.precos[orcando.id] ?? null) : null}
        onOpenChange={(v) => !v && setOrcando(null)}
      />
      <ApontarFotoDialog
        item={apontando}
        fotos={fotos}
        onOpenChange={(v) => !v && setApontando(null)}
        onApontada={onMudou}
      />
      <ResolverDuvidaDialog
        item={resolvendo}
        onOpenChange={(v) => !v && setResolvendo(null)}
        onResolvida={onMudou}
      />
      <GerarLinkDialog
        aberto={gerandoLink}
        catalogoId={catalogoId}
        itens={[...escolhidos]}
        onOpenChange={setGerandoLink}
        onGerado={() => {
          setEscolhendo(false);
          setEscolhidos(new Set());
        }}
      />
    </div>
  );
}
