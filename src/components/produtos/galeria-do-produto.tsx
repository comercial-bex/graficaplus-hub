import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, RefreshCw, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FotoAmpliavel } from "@/components/produtos/foto-ampliavel";
import {
  capaDaGaleria,
  emOrdem,
  LIMITE_DA_FOTO_MB,
  type ImagemDaGaleria,
} from "@/domain/catalogo/galeria-do-produto";
import {
  adicionarFoto,
  atualizarLegenda,
  definirCapa,
  ErroDaGaleria,
  listarImagens,
  moverFoto,
  removerFoto,
  trocarFoto,
} from "@/lib/api/produto-imagens";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

/**
 * Galeria de fotos do produto (17/11/2026): várias fotos, uma delas é a capa. A capa é a foto que o
 * parceiro, o orçamento e a tabela de preços mostram (o banco mantém `produtos.imagem_url` igual a ela).
 *
 * - Adicionar NUNCA tira nem troca a foto que já existe; a primeira foto vira capa sozinha.
 * - Remover pede confirmação em palavras e só apaga o arquivo se nenhum outro registro usa.
 * - Carregando, erro e vazio aparecem escritos. Migração ainda não aplicada vira um aviso claro, e a tela
 *   nunca grava direto em `produtos`.
 *
 * Mínimo 16 px: toda letra daqui é `text-base`.
 */
const BOTAO = "h-10 text-base";

export function GaleriaDoProduto({
  produtoId,
  nome,
  podeEditar = true,
  aoMudar,
}: {
  produtoId: string;
  nome: string;
  /** Só administrador e gerência mexem; os outros veem a galeria sem botões. */
  podeEditar?: boolean;
  /** Chamado depois de qualquer mudança que possa trocar a capa (a capa nova, ou nulo se ficou sem). */
  aoMudar?: (capaUrl: string | null) => void;
}) {
  const fila = useQueryClient();
  const chave = ["produto-imagens", produtoId] as const;
  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => listarImagens(produtoId),
    retry: false,
  });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<ImagemDaGaleria | null>(null);
  const novo = useRef<HTMLInputElement>(null);
  const troca = useRef<HTMLInputElement>(null);
  const [trocando, setTrocando] = useState<ImagemDaGaleria | null>(null);

  const imagens = emOrdem(consulta.data ?? []);
  const capa = capaDaGaleria(imagens);

  async function executar(quem: string, acao: () => Promise<string | void>, ok: string) {
    setOcupado(quem);
    try {
      const extra = await acao();
      toast.success(extra ? `${ok} ${extra}` : ok);
    } catch (e) {
      toast.error(
        e instanceof ErroDaGaleria
          ? e.message
          : mensagemErro(e, "Não foi possível concluir. Tente de novo."),
      );
    } finally {
      // Quer deu certo, quer não, a lista volta a ser lida do banco: o que a tela mostra é o que o banco tem.
      const nova = await consulta.refetch().catch(() => null);
      void fila.invalidateQueries({ queryKey: ["produtos"] });
      void fila.invalidateQueries({ queryKey: ["tabela-precos", "produtos"] });
      if (nova?.data) aoMudar?.(capaDaGaleria(nova.data)?.url ?? null);
      setOcupado(null);
    }
  }

  const enviarNova = (arquivo: File) =>
    executar(
      "nova",
      async () => void (await adicionarFoto(produtoId, arquivo, imagens)),
      "Foto adicionada. As outras continuam na galeria.",
    );

  const trocarArquivo = (img: ImagemDaGaleria, arquivo: File) =>
    executar(
      img.id,
      async () => {
        const r = await trocarFoto(img, arquivo);
        return r.arquivoApagado
          ? "O arquivo antigo foi apagado."
          : "O arquivo antigo foi mantido, porque outro registro ainda usa.";
      },
      "Foto trocada.",
    );

  const bloqueado = ocupado !== null;
  const erro = consulta.isError
    ? consulta.error instanceof ErroDaGaleria
      ? consulta.error
      : null
    : null;

  return (
    <section className="space-y-3" aria-label={`Fotos de ${nome}`} data-testid="galeria-do-produto">
      <input
        ref={novo}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Escolher foto para adicionar"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviarNova(f);
        }}
      />
      <input
        ref={troca}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Escolher a foto que vai trocar"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && trocando) void trocarArquivo(trocando, f);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        {podeEditar && (
          <Button
            type="button"
            variant="outline"
            className={BOTAO}
            disabled={bloqueado || consulta.isError}
            onClick={() => novo.current?.click()}
          >
            {ocupado === "nova" ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            Adicionar foto
          </Button>
        )}
        <p className="text-base text-muted-foreground">
          JPG, PNG ou WebP, até {LIMITE_DA_FOTO_MB} MB cada.
        </p>
      </div>

      {consulta.isPending ? (
        <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Carregando as fotos do produto...
        </p>
      ) : consulta.isError ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
        >
          <p className="text-base text-foreground">
            {erro?.message ??
              "Não foi possível carregar as fotos do produto. Isto não quer dizer que o produto não tenha fotos."}
          </p>
          <Button
            type="button"
            variant="outline"
            className={BOTAO}
            onClick={() => void consulta.refetch()}
          >
            <RefreshCw /> Tentar de novo
          </Button>
        </div>
      ) : imagens.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-border p-4 text-base text-foreground"
          data-testid="galeria-vazia"
        >
          Este produto ainda não tem fotos. {podeEditar ? "Envie a primeira: ela vira a capa." : ""}
        </p>
      ) : (
        <>
          {!capa && (
            <p
              role="status"
              className="rounded-md border border-warning/50 bg-warning/15 p-3 text-base text-foreground"
            >
              Nenhuma foto é a capa agora, e a tabela de preços e o painel do parceiro estão sem
              foto. {podeEditar ? "Escolha uma com o botão Tornar capa." : ""}
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {imagens.map((img, i) => (
              <li
                key={img.id}
                className={cn(
                  "space-y-2 rounded-lg border p-2",
                  img.capa ? "border-primary ring-1 ring-primary" : "border-border",
                )}
              >
                <FotoAmpliavel
                  url={img.url}
                  alt={`Foto ${i + 1} de ${nome}`}
                  legenda={img.legenda}
                  className="block w-full"
                >
                  <img
                    src={img.url}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full rounded-md bg-muted object-cover"
                  />
                </FotoAmpliavel>
                <div className="flex flex-wrap gap-2 text-base">
                  {img.capa && (
                    <span className="rounded-md bg-primary px-2 py-0.5 font-semibold text-primary-foreground">
                      Capa
                    </span>
                  )}
                  <span className="rounded-md border border-border px-2 py-0.5 text-foreground">
                    {img.origem === "ia" ? "Gerada pela IA" : "Enviada por você"}
                  </span>
                </div>
                {podeEditar && (
                  <>
                    <Input
                      key={`${img.id}-${img.legenda ?? ""}`}
                      defaultValue={img.legenda ?? ""}
                      placeholder="Legenda (opcional)"
                      aria-label={`Legenda da foto ${i + 1}`}
                      className="h-10 text-base"
                      disabled={bloqueado}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (img.legenda ?? ""))
                          void executar(
                            img.id,
                            () => atualizarLegenda(img.id, e.target.value),
                            "Legenda guardada.",
                          );
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      {!img.capa && (
                        <Button
                          type="button"
                          variant="outline"
                          className={BOTAO}
                          disabled={bloqueado}
                          onClick={() =>
                            void executar(img.id, () => definirCapa(img.id), "Capa definida.")
                          }
                        >
                          {ocupado === img.id ? <Loader2 className="animate-spin" /> : <Star />}{" "}
                          Tornar capa
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className={BOTAO}
                        disabled={bloqueado}
                        onClick={() => {
                          setTrocando(img);
                          troca.current?.click();
                        }}
                      >
                        <ImagePlus /> Trocar foto
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className={BOTAO}
                        disabled={bloqueado || i === 0}
                        aria-label={`Subir a foto ${i + 1}`}
                        onClick={() =>
                          void executar(
                            img.id,
                            () => moverFoto(imagens, img.id, "subir"),
                            "Ordem mudada.",
                          )
                        }
                      >
                        <ArrowUp /> Subir
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className={BOTAO}
                        disabled={bloqueado || i === imagens.length - 1}
                        aria-label={`Descer a foto ${i + 1}`}
                        onClick={() =>
                          void executar(
                            img.id,
                            () => moverFoto(imagens, img.id, "descer"),
                            "Ordem mudada.",
                          )
                        }
                      >
                        <ArrowDown /> Descer
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(BOTAO, "text-destructive")}
                        disabled={bloqueado}
                        onClick={() => setRemovendo(img)}
                      >
                        <Trash2 /> Remover
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <AlertDialog open={!!removendo} onOpenChange={(v) => !v && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Remover esta foto?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              A foto sai da galeria de {nome}.
              {removendo?.capa && imagens.length > 1
                ? " Ela é a capa: a próxima foto da fila passa a ser a capa."
                : removendo?.capa
                  ? " Ela é a única foto: o produto fica sem foto na tabela e no painel do parceiro."
                  : ""}{" "}
              O arquivo é apagado do armazenamento se nenhum outro produto usar a mesma imagem. Isto
              não volta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={BOTAO}>Não, manter a foto</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className={BOTAO}
              onClick={() => {
                const img = removendo;
                setRemovendo(null);
                if (img) {
                  void executar(
                    img.id,
                    async () =>
                      (await removerFoto(img)).arquivoApagado
                        ? "O arquivo foi apagado."
                        : "O arquivo foi mantido, porque outro registro ainda usa.",
                    "Foto removida.",
                  );
                }
              }}
            >
              Sim, remover a foto
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
