import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import {
  BUCKET_DE_FOTOS,
  caminhoDaFotoNoStorage,
  conferirFotos,
  type ProblemaDaFoto,
} from "@/domain/catalogo/fotos";
import { registrarFotos } from "@/components/catalogo/consultas";

type Resultado = { fotos: number; itensApontados: number; codigosSemItem: string[]; falhas: ProblemaDaFoto[] };

/** O banco registra até 300 fotos por chamada. */
const POR_CHAMADA = 300;

/**
 * Fotos em lote: a pessoa escolhe as imagens com o NOME DO ARQUIVO igual ao
 * código do fornecedor ("LG3561.jpg"). Cada uma sobe com nome sorteado (o
 * cliente vê a URL da imagem — o código do fornecedor não pode estar nela), e
 * o banco confere que o arquivo chegou, guarda no acervo e aponta nos itens
 * daquele código que estão sem foto (ou em todos, se marcar "substituir").
 */
export function FotosEmLote({
  catalogoId,
  semFoto,
  aConferir,
  onRegistradas,
}: {
  catalogoId: string;
  semFoto: number;
  aConferir: number;
  onRegistradas: () => void;
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [substituir, setSubstituir] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const conferidas = conferirFotos(arquivos);

  async function enviar() {
    if (conferidas.validas.length === 0) return;
    setEnviando(true);
    setResultado(null);
    setProgresso(0);
    const subidas: { caminho: string; codigo_fornecedor: string }[] = [];
    const falhas: ProblemaDaFoto[] = [...conferidas.problemas];
    try {
      for (const [n, v] of conferidas.validas.entries()) {
        const arquivo = arquivos[v.indice];
        const caminho = caminhoDaFotoNoStorage(catalogoId, crypto.randomUUID(), arquivo.type);
        if (!caminho) {
          falhas.push({ arquivo: arquivo.name, motivo: "tipo de imagem não aceito" });
          continue;
        }
        const { error } = await supabase.storage
          .from(BUCKET_DE_FOTOS)
          .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
        if (error) falhas.push({ arquivo: arquivo.name, motivo: mensagemErro(error) });
        else subidas.push({ caminho, codigo_fornecedor: v.codigo });
        setProgresso(Math.round(((n + 1) / conferidas.validas.length) * 100));
      }

      let fotos = 0;
      let itensApontados = 0;
      const codigosSemItem: string[] = [];
      for (let i = 0; i < subidas.length; i += POR_CHAMADA) {
        const lote = subidas.slice(i, i + POR_CHAMADA);
        try {
          const r = await registrarFotos(catalogoId, lote, substituir);
          fotos += r.fotos;
          itensApontados += r.itens_apontados;
          codigosSemItem.push(...r.codigos_sem_item);
        } catch (e) {
          // O banco não registrou: as imagens desse lote saem do armazenamento,
          // para não ficarem órfãs ocupando espaço sem ninguém saber delas.
          await supabase.storage.from(BUCKET_DE_FOTOS).remove(lote.map((f) => f.caminho));
          for (const f of lote) falhas.push({ arquivo: f.codigo_fornecedor, motivo: mensagemErro(e) });
        }
      }
      setResultado({ fotos, itensApontados, codigosSemItem, falhas });
      if (fotos > 0) {
        toast.success(`${fotos} fotos registradas, ${itensApontados} itens com foto nova.`);
        onRegistradas();
      }
      setArquivos([]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fotos em lote</CardTitle>
        <CardDescription>
          O nome de cada arquivo é o código do fornecedor (LG3561.jpg, 6035-8ZN.png). WEBP, JPG ou PNG, até 2 MB.
          Hoje: {semFoto} itens sem foto, {aConferir} com foto a conferir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm hover:bg-muted">
          <ImagePlus className="h-4 w-4" />
          <span>{arquivos.length > 0 ? `${arquivos.length} arquivos escolhidos` : "Escolher as fotos"}</span>
          <Input
            type="file"
            multiple
            accept="image/webp,image/jpeg,image/png"
            className="sr-only"
            disabled={enviando}
            onChange={(e) => {
              setArquivos(Array.from(e.target.files ?? []));
              setResultado(null);
              e.target.value = "";
            }}
          />
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox checked={substituir} onCheckedChange={(v) => setSubstituir(v === true)} disabled={enviando} />
          Substituir também a foto dos itens que já têm foto
        </label>

        {conferidas.problemas.length > 0 && (
          <ul className="space-y-0.5 text-sm text-destructive">
            {conferidas.problemas.map((p) => (
              <li key={p.arquivo}>
                {p.arquivo}: {p.motivo}
              </li>
            ))}
          </ul>
        )}

        {enviando && <Progress value={progresso} />}

        <Button
          className="h-11 md:h-9"
          disabled={enviando || conferidas.validas.length === 0}
          onClick={() => void enviar()}
        >
          {enviando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Enviar {conferidas.validas.length > 0 ? `${conferidas.validas.length} fotos` : "fotos"}
        </Button>

        {resultado && (
          <div className="space-y-1 rounded-md border border-border p-3 text-sm">
            <p>
              {resultado.fotos} fotos registradas · {resultado.itensApontados} itens passaram a ter foto.
            </p>
            {resultado.codigosSemItem.length > 0 && (
              <p className="text-muted-foreground">
                Códigos sem item no catálogo (a foto ficou no acervo para apontar à mão):{" "}
                {resultado.codigosSemItem.join(", ")}.
              </p>
            )}
            {resultado.falhas.length > 0 && (
              <ul className="space-y-0.5 text-destructive">
                {resultado.falhas.map((f, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f.arquivo}: {f.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
