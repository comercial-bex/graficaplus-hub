/* eslint-disable @typescript-eslint/no-explicit-any -- orcamento_item_arquivos não está nos tipos gerados */
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageOff,
  Images,
  Loader2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";

/**
 * Os layouts (artes a imprimir) de cada item do orçamento.
 *
 * Um item pode ter várias artes — frente e verso, variações, o arquivo de
 * produção e a imagem que o cliente mandou. A PRIMEIRA da lista é a capa: é a
 * miniatura que sai no bloco LAYOUT do PDF e no link do cliente. "Usar como
 * capa" leva a arte para o primeiro lugar; as setas mudam a ordem.
 *
 * No banco: `orcamento_item_arquivos` (item, arquivo, `capa`, `ordem`) é a
 * fonte; `orcamento_itens.arquivo_id` espelha a capa, porque é ele que a
 * conversão em OS copia para o item da OS. Toda mudança regrava `ordem` 0..n-1
 * na ordem da tela e `capa` só na primeira — as duas colunas nunca discordam.
 *
 * O arquivo vai para `arquivos-clientes/orcamento/<orçamento>/…`. Essa pasta
 * abre para quem edita orçamento (migração 20261005234000): até 05/10 o
 * vendedor recebia "violates row-level security" ao anexar, porque o Storage
 * exigia `arquivos.upload`, que o papel dele não tem.
 */

const BUCKET = "arquivos-clientes";
/** Imagem, PDF e os arquivos de design que a gráfica recebe. */
export const ACEITA_LAYOUT = "image/*,application/pdf,.pdf,.cdr,.ai,.eps,.psd,.svg";

export type Layout = {
  /** chave estável para o React: o vínculo, ou o arquivo no rascunho */
  chave: string;
  arquivo_id: string;
  nome: string;
  url: string | null;
  pdf: boolean;
  vinculo_id?: string;
};

export type LayoutRascunho = {
  arquivo_id: string;
  nome: string;
  mime: string | null;
  /** URL local (objectURL) para a miniatura antes de existir o item */
  previa: string | null;
};

function extensao(nome: string): string {
  return (nome.split(".").pop() ?? "").toLowerCase();
}

function ehPdf(nome: string, mime?: string | null): boolean {
  return mime === "application/pdf" || extensao(nome) === "pdf";
}

/** O navegador desenha? (CDR, AI, PSD e EPS não: viram ficha com o nome) */
function ehImagemVisivel(nome: string, mime?: string | null): boolean {
  if (mime) return mime.startsWith("image/") && !/photoshop|postscript|illustrator/.test(mime);
  return ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"].includes(extensao(nome));
}

/** Sobe a arte e registra em `arquivos` como tipo 'arte'. Erro sobe, nunca some. */
export async function enviarLayout(
  arquivo: File,
  orcamentoId: string,
  clienteId: string | null,
): Promise<{ id: string; nome: string; mime: string | null }> {
  const ext = extensao(arquivo.name).replace(/[^a-z0-9]/g, "") || "bin";
  const caminho = `orcamento/${orcamentoId}/${crypto.randomUUID()}.${ext}`;
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, arquivo, { contentType: arquivo.type || undefined });
  if (erroUpload) throw erroUpload;

  const { data, error } = await supabase
    .from("arquivos")
    .insert({
      nome: arquivo.name,
      caminho,
      // 'arte' é o que a produção procura como layout a imprimir
      tipo: "arte",
      cliente_id: clienteId,
      tamanho_bytes: arquivo.size,
      mime_type: arquivo.type || null,
    } as never)
    .select("id, nome")
    .single();
  if (error) throw error;
  const registro = data as { id: string; nome: string };
  return { id: registro.id, nome: registro.nome, mime: arquivo.type || null };
}

/** URLs assinadas de uma vez só (o bucket é privado). */
async function urlsAssinadas(caminhos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (caminhos.length === 0) return mapa;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, 600);
  if (error) throw error;
  for (const linha of data ?? []) {
    if (linha.path && linha.signedUrl) mapa.set(linha.path, linha.signedUrl);
  }
  return mapa;
}

/* ------------------------------------------------------------------------- */
/* A grade: soltar arquivos, capa, ordem, remover                             */
/* ------------------------------------------------------------------------- */

function GradeDeLayouts({
  layouts,
  enviando,
  desabilitado,
  onEnviar,
  onCapa,
  onMover,
  onRemover,
}: {
  layouts: Layout[];
  enviando: boolean;
  desabilitado?: boolean;
  onEnviar: (arquivos: File[]) => void;
  onCapa: (indice: number) => void;
  onMover: (indice: number, passo: -1 | 1) => void;
  onRemover: (indice: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const bloqueado = desabilitado || enviando;

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={bloqueado ? -1 : 0}
        aria-disabled={bloqueado}
        onClick={() => !bloqueado && input.current?.click()}
        onKeyDown={(e) => {
          if (!bloqueado && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!bloqueado) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (bloqueado) return;
          const arquivos = Array.from(e.dataTransfer.files ?? []);
          if (arquivos.length) onEnviar(arquivos);
        }}
        className={cn(
          "flex min-h-[72px] cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-center text-sm transition-colors",
          arrastando ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
          bloqueado && "cursor-not-allowed opacity-60",
        )}
      >
        {enviando ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
        ) : (
          <Upload className="h-5 w-5 shrink-0" />
        )}
        <div>
          <p className="font-medium">
            {enviando ? "Enviando…" : "Arraste as artes aqui ou clique para escolher"}
          </p>
          <p className="text-xs text-muted-foreground">
            Imagem, PDF ou arquivo de design (CDR, AI, PSD). Pode mandar várias de uma vez.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACEITA_LAYOUT}
          className="hidden"
          aria-label="Escolher artes"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (arquivos.length) onEnviar(arquivos);
          }}
        />
      </div>

      {layouts.length > 0 && (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {layouts.map((l, i) => (
            <li
              key={l.chave}
              className={cn(
                "overflow-hidden rounded-lg border bg-card",
                i === 0 && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="relative grid h-24 place-items-center overflow-hidden bg-muted">
                {l.url && !l.pdf ? (
                  <img src={l.url} alt={`Arte ${l.nome}`} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    {l.pdf ? <FileText className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />}
                    <span className="text-[11px] uppercase">{extensao(l.nome) || "arquivo"}</span>
                  </div>
                )}
                <span
                  className={cn(
                    "absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                    i === 0 ? "bg-primary text-primary-foreground" : "bg-background/90",
                  )}
                >
                  {i === 0 ? "Capa" : i + 1}
                </span>
              </div>
              <div className="space-y-1 p-1.5">
                <p className="truncate text-xs" title={l.nome}>
                  {l.nome}
                </p>
                <div className="flex items-center justify-between gap-1">
                  {i === 0 ? (
                    <span className="text-[11px] text-primary">sai no PDF</span>
                  ) : (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={bloqueado}
                      title="Usar como capa (sai no PDF)"
                      aria-label={`Usar ${l.nome} como capa`}
                      onClick={() => onCapa(i)}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <div className="flex">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={bloqueado || i === 0}
                      title="Mover para antes"
                      aria-label={`Mover ${l.nome} para antes`}
                      onClick={() => onMover(i, -1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={bloqueado || i === layouts.length - 1}
                      title="Mover para depois"
                      aria-label={`Mover ${l.nome} para depois`}
                      onClick={() => onMover(i, 1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      disabled={bloqueado}
                      title="Tirar esta arte do item"
                      aria-label={`Tirar ${l.nome} do item`}
                      onClick={() => onRemover(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Nova ordem depois de "usar como capa" (vai para o 1º) ou de mover um passo. */
export function reordenar<T>(lista: T[], indice: number, destino: number): T[] {
  if (destino < 0 || destino >= lista.length || indice === destino) return lista;
  const nova = [...lista];
  const [item] = nova.splice(indice, 1);
  nova.splice(destino, 0, item);
  return nova;
}

/* ------------------------------------------------------------------------- */
/* Antes de o item existir: as artes ficam no formulário                      */
/* ------------------------------------------------------------------------- */

export function LayoutsDoRascunho({
  orcamentoId,
  clienteId,
  layouts,
  setLayouts,
  desabilitado,
}: {
  orcamentoId: string;
  clienteId: string | null;
  layouts: LayoutRascunho[];
  setLayouts: Dispatch<SetStateAction<LayoutRascunho[]>>;
  desabilitado?: boolean;
}) {
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivos: File[]) {
    setEnviando(true);
    let enviados = 0;
    try {
      for (const arquivo of arquivos) {
        const r = await enviarLayout(arquivo, orcamentoId, clienteId);
        const previa = ehImagemVisivel(arquivo.name, arquivo.type) ? URL.createObjectURL(arquivo) : null;
        // um por um: se o terceiro falhar, os dois primeiros já estão na lista
        setLayouts((atual) => [...atual, { arquivo_id: r.id, nome: r.nome, mime: r.mime, previa }]);
        enviados += 1;
      }
      toast.success(enviados === 1 ? "Arte anexada" : `${enviados} artes anexadas`);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar a arte"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <GradeDeLayouts
      layouts={layouts.map((l) => ({
        chave: l.arquivo_id,
        arquivo_id: l.arquivo_id,
        nome: l.nome,
        url: l.previa,
        pdf: ehPdf(l.nome, l.mime),
      }))}
      enviando={enviando}
      desabilitado={desabilitado}
      onEnviar={(arquivos) => void enviar(arquivos)}
      onCapa={(i) => setLayouts((atual) => reordenar(atual, i, 0))}
      onMover={(i, passo) => setLayouts((atual) => reordenar(atual, i, i + passo))}
      onRemover={(i) =>
        setLayouts((atual) => {
          const tirado = atual[i];
          if (tirado?.previa) URL.revokeObjectURL(tirado.previa);
          return atual.filter((_, n) => n !== i);
        })
      }
    />
  );
}

/** Grava as artes do rascunho no item recém-criado, já na ordem da tela. */
export async function vincularLayouts(itemId: string, layouts: { arquivo_id: string }[]) {
  if (layouts.length === 0) return;
  const { error } = await (supabase as any).from("orcamento_item_arquivos").insert(
    layouts.map((l, ordem) => ({ item_id: itemId, arquivo_id: l.arquivo_id, capa: ordem === 0, ordem })),
  );
  if (error) throw error;
}

/* ------------------------------------------------------------------------- */
/* Item gravado: as artes vivem no banco                                      */
/* ------------------------------------------------------------------------- */

async function carregarLayoutsDoItem(itemId: string): Promise<Layout[]> {
  const { data: vinculos, error } = await (supabase as any)
    .from("orcamento_item_arquivos")
    .select("id, arquivo_id, capa, ordem")
    .eq("item_id", itemId)
    .order("capa", { ascending: false })
    .order("ordem");
  if (error) throw error;
  const lista = (vinculos ?? []) as { id: string; arquivo_id: string }[];
  if (lista.length === 0) return [];

  const { data: arquivos, error: erroArquivos } = await supabase
    .from("arquivos")
    .select("id, nome, caminho, mime_type")
    .in(
      "id",
      lista.map((v) => v.arquivo_id),
    );
  if (erroArquivos) throw erroArquivos;
  const porId = new Map(
    ((arquivos ?? []) as { id: string; nome: string; caminho: string; mime_type: string | null }[]).map(
      (a) => [a.id, a],
    ),
  );
  const visiveis = [...porId.values()].filter((a) => ehImagemVisivel(a.nome, a.mime_type));
  const urls = await urlsAssinadas(visiveis.map((a) => a.caminho));

  return lista.map((v) => {
    const a = porId.get(v.arquivo_id);
    return {
      chave: v.id,
      vinculo_id: v.id,
      arquivo_id: v.arquivo_id,
      nome: a?.nome ?? "arquivo",
      url: a ? (urls.get(a.caminho) ?? null) : null,
      pdf: a ? ehPdf(a.nome, a.mime_type) : false,
    };
  });
}

/** Regrava ordem e capa na ordem da tela e espelha a capa no item. */
async function gravarOrdem(itemId: string, lista: Layout[]) {
  for (const [ordem, l] of lista.entries()) {
    const { error } = await (supabase as any)
      .from("orcamento_item_arquivos")
      .update({ ordem, capa: ordem === 0 })
      .eq("id", l.vinculo_id);
    if (error) throw error;
  }
  const { data, error } = await supabase
    .from("orcamento_itens")
    .update({ arquivo_id: lista[0]?.arquivo_id ?? null } as never)
    .eq("id", itemId)
    .select("id");
  if (error) throw error;
  // escrita barrada pela RLS devolve 0 linhas e nenhum erro
  if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar este item.");
}

export function LayoutsDoItem({
  itemId,
  orcamentoId,
  clienteId,
  podeEditar,
}: {
  itemId: string;
  orcamentoId: string;
  clienteId: string | null;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const chave = ["orc-item-layouts", itemId];
  const consulta = useQuery({ queryKey: chave, queryFn: () => carregarLayoutsDoItem(itemId) });
  const [ocupado, setOcupado] = useState(false);
  const layouts = consulta.data ?? [];

  async function executar(acao: () => Promise<void>, sucesso: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(sucesso);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível mudar as artes"));
    } finally {
      setOcupado(false);
      await qc.invalidateQueries({ queryKey: chave });
      await qc.invalidateQueries({ queryKey: ["orc-capas", orcamentoId] });
      await qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] });
    }
  }

  async function enviar(arquivos: File[]) {
    await executar(async () => {
      let ordem = layouts.length;
      for (const arquivo of arquivos) {
        const r = await enviarLayout(arquivo, orcamentoId, clienteId);
        const { error } = await (supabase as any)
          .from("orcamento_item_arquivos")
          .insert({ item_id: itemId, arquivo_id: r.id, capa: ordem === 0, ordem });
        if (error) throw error;
        if (ordem === 0) {
          const { error: erroCapa } = await supabase
            .from("orcamento_itens")
            .update({ arquivo_id: r.id } as never)
            .eq("id", itemId);
          if (erroCapa) throw erroCapa;
        }
        ordem += 1;
      }
    }, arquivos.length > 1 ? "Artes anexadas" : "Arte anexada");
  }

  if (consulta.isError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="space-y-2">
          <p>Não foi possível carregar as artes deste item: {mensagemErro(consulta.error)}</p>
          <Button size="sm" variant="outline" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }
  if (consulta.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as artes…
      </p>
    );
  }

  return (
    <GradeDeLayouts
      layouts={layouts}
      enviando={ocupado}
      desabilitado={!podeEditar}
      onEnviar={(arquivos) => void enviar(arquivos)}
      onCapa={(i) => void executar(() => gravarOrdem(itemId, reordenar(layouts, i, 0)), "Capa trocada")}
      onMover={(i, passo) =>
        void executar(() => gravarOrdem(itemId, reordenar(layouts, i, i + passo)), "Ordem salva")
      }
      onRemover={(i) =>
        void executar(async () => {
          const tirado = layouts[i];
          const { error } = await (supabase as any)
            .from("orcamento_item_arquivos")
            .delete()
            .eq("id", tirado.vinculo_id);
          if (error) throw error;
          await gravarOrdem(
            itemId,
            layouts.filter((_, n) => n !== i),
          );
        }, "Arte tirada do item")
      }
    />
  );
}

/* ------------------------------------------------------------------------- */
/* Na tabela: a capa de cada item, e o diálogo para mexer                     */
/* ------------------------------------------------------------------------- */

export type CapaDoItem = { nome: string; url: string | null; pdf: boolean; total: number };

/** A capa (e quantas artes) de cada item, numa ida só ao banco. */
export function useCapasDosItens(orcamentoId: string, itemIds: string[]) {
  return useQuery({
    queryKey: ["orc-capas", orcamentoId, itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async (): Promise<Record<string, CapaDoItem>> => {
      const { data: vinculos, error } = await (supabase as any)
        .from("orcamento_item_arquivos")
        .select("item_id, arquivo_id, capa, ordem")
        .in("item_id", itemIds)
        .order("capa", { ascending: false })
        .order("ordem");
      if (error) throw error;
      const porItem = new Map<string, string[]>();
      for (const v of (vinculos ?? []) as { item_id: string; arquivo_id: string }[]) {
        porItem.set(v.item_id, [...(porItem.get(v.item_id) ?? []), v.arquivo_id]);
      }
      const capas = [...porItem.values()].map((l) => l[0]);
      if (capas.length === 0) return {};

      const { data: arquivos, error: erroArquivos } = await supabase
        .from("arquivos")
        .select("id, nome, caminho, mime_type")
        .in("id", capas);
      if (erroArquivos) throw erroArquivos;
      const porId = new Map(
        ((arquivos ?? []) as { id: string; nome: string; caminho: string; mime_type: string | null }[]).map(
          (a) => [a.id, a],
        ),
      );
      const visiveis = [...porId.values()].filter((a) => ehImagemVisivel(a.nome, a.mime_type));
      const urls = await urlsAssinadas(visiveis.map((a) => a.caminho));

      const resultado: Record<string, CapaDoItem> = {};
      for (const [itemId, lista] of porItem) {
        const a = porId.get(lista[0]);
        resultado[itemId] = {
          nome: a?.nome ?? "arquivo",
          url: a ? (urls.get(a.caminho) ?? null) : null,
          pdf: a ? ehPdf(a.nome, a.mime_type) : false,
          total: lista.length,
        };
      }
      return resultado;
    },
  });
}

/** Miniatura da capa na linha da tabela; o clique abre as artes do item. */
export function MiniaturaDoItem({ capa, onAbrir }: { capa: CapaDoItem | undefined; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group flex items-center gap-2 rounded-md text-left text-xs"
      title={capa ? "Ver e mexer nas artes do item" : "Anexar arte ao item"}
    >
      <span
        className={cn(
          "relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted",
          !capa && "border-dashed border-amber-500/60",
        )}
      >
        {capa?.url && !capa.pdf ? (
          <img src={capa.url} alt={`Capa: ${capa.nome}`} className="h-full w-full object-cover" />
        ) : capa ? (
          <FileText className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Images className="h-5 w-5 text-amber-500" />
        )}
        {capa && capa.total > 1 && (
          <span className="absolute bottom-0 right-0 rounded-tl bg-background/90 px-1 text-[10px] font-medium">
            +{capa.total - 1}
          </span>
        )}
      </span>
      <span className={cn("group-hover:underline", capa ? "text-muted-foreground" : "text-amber-500")}>
        {capa ? (capa.total === 1 ? "1 arte" : `${capa.total} artes`) : "sem arte"}
      </span>
    </button>
  );
}

export function DialogoDeLayouts({
  item,
  orcamentoId,
  clienteId,
  podeEditar,
  onFechar,
}: {
  item: { id: string; descricao: string; numero: number } | null;
  orcamentoId: string;
  clienteId: string | null;
  podeEditar: boolean;
  onFechar: () => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Artes do item {item?.numero} · {item?.descricao}
          </DialogTitle>
          <DialogDescription>
            A primeira é a capa: é ela que sai no PDF e no link do cliente. As outras vão juntas
            para a produção.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <LayoutsDoItem
            itemId={item.id}
            orcamentoId={orcamentoId}
            clienteId={clienteId}
            podeEditar={podeEditar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
