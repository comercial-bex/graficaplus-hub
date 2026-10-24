import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Search, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { mensagemErro } from "@/lib/erros";
import {
  gravarJobsDoFlexi,
  lerPrintDoFlexi,
  type LeituraDoPrint,
} from "@/lib/api/flexi-importar.functions";
import { sugerirVinculos } from "@/lib/api/flexi-vinculos.functions";
import { areaM2, resumoDosJobs, type JobFlexi, type LinhaRejeitada } from "@/domain/flexi/jobs";
import { ConferirJobDialog } from "@/components/flexi/conferir-job";
import { rotuloDoVinculo, type JobParaConferir, type VinculoDoJob } from "@/domain/flexi/rotulos";

export const Route = createFileRoute("/_authenticated/importar-flexi")({
  head: () => ({
    meta: [
      { title: "Jobs do Flexi — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Importa a fila de impressão do FlexiPRINT a partir de um print, com conferência antes de gravar.",
      },
    ],
  }),
  component: ImportarFlexiPage,
});

const LIMITE_DA_IMAGEM = 8_000_000;

const STATUS_ROTULO: Record<JobFlexi["status"], string> = {
  concluido: "Concluído",
  abortado: "Abortado",
  mantendo: "Mantendo",
  outro: "—",
};

const formatoData = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Belem",
});
const m2 = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    leitor.readAsDataURL(arquivo);
  });
}

type JobGravado = {
  id: string;
  nome_job: string;
  status_flexi: JobFlexi["status"];
  largura_cm: number;
  altura_cm: number;
  copias: number;
  area_m2: number;
  impresso_em: string;
  aninhado: boolean;
  // Um job tem no máximo um vínculo; o PostgREST devolve objeto ou lista de um.
  rip_job_vinculos: VinculoDoJob | VinculoDoJob[] | null;
};

const TOM_DO_VINCULO = {
  ok: "text-foreground font-medium",
  atencao: "text-foreground underline decoration-dotted underline-offset-4",
  neutro: "text-muted-foreground",
} as const;

function vinculoDe(j: JobGravado): VinculoDoJob | null {
  const v = Array.isArray(j.rip_job_vinculos) ? j.rip_job_vinculos[0] : j.rip_job_vinculos;
  return v ?? null;
}

function ImportarFlexiPage() {
  const queryClient = useQueryClient();
  const lerPrint = useServerFn(lerPrintDoFlexi);
  const gravar = useServerFn(gravarJobsDoFlexi);
  const entrada = useRef<HTMLInputElement>(null);

  const [maquinaId, setMaquinaId] = useState<string>("");
  const [imagem, setImagem] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobFlexi[]>([]);
  const [rejeitadas, setRejeitadas] = useState<LinhaRejeitada[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState<JobParaConferir | null>(null);
  const [soPendentes, setSoPendentes] = useState(false);
  const procurarOrcamentos = useServerFn(sugerirVinculos);

  const maquinas = useQuery({
    queryKey: ["maquinas-plotter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("id, nome")
        .eq("tipo", "plotter_impressao")
        .eq("ativa", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    // Uma plotter só: já vem escolhida.
    if (!maquinaId && maquinas.data?.length === 1) setMaquinaId(maquinas.data[0].id);
  }, [maquinas.data, maquinaId]);

  const recentes = useQuery({
    queryKey: ["rip-jobs-recentes"],
    queryFn: async () => {
      // `as any`: a tabela é nova e ainda não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("rip_jobs")
        .select(
          "id, nome_job, status_flexi, largura_cm, altura_cm, copias, area_m2, impresso_em, aninhado, rip_job_vinculos(estado, origem, orcamento_numero, orcamento_titulo, item_descricao, confianca, motivos, candidatos, motivo_sem_orcamento)",
        )
        .order("impresso_em", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as JobGravado[];
    },
  });

  const procurar = useMutation({
    mutationFn: async () => procurarOrcamentos(),
    onSuccess: (r) => {
      toast.success(
        r.analisados === 0
          ? "Nenhum job esperando orçamento."
          : `${r.analisados} job(s) olhados: ${r.sugeridos} com sugestão, ${r.revisar} para escolher, ${r.semCandidato} sem candidato.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["rip-jobs-recentes"] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível procurar os orçamentos.")),
  });

  async function receberArquivo(arquivo: File | null | undefined) {
    if (!arquivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) {
      toast.error("Envie um print em PNG, JPEG ou WebP.");
      return;
    }
    if (arquivo.size > LIMITE_DA_IMAGEM * 0.7) {
      toast.error("A imagem é grande demais. Tire um print só da fila.");
      return;
    }
    setImagem(await lerArquivo(arquivo));
    setJobs([]);
    setRejeitadas([]);
    setAviso(null);
  }

  useEffect(() => {
    // Ctrl+V com o print copiado: o caminho mais curto para o operador.
    function aoColar(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (item) void receberArquivo(item.getAsFile());
    }
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);

  const ler = useMutation({
    mutationFn: async () => {
      if (!imagem) throw new Error("Envie o print primeiro.");
      return (await lerPrint({ data: { imagem } })) as LeituraDoPrint;
    },
    onSuccess: (r) => {
      if (r.estado === "ok") {
        setJobs(r.jobs);
        setRejeitadas(r.rejeitadas);
        setAviso(null);
        return;
      }
      setJobs([]);
      setRejeitadas([]);
      setAviso(
        r.estado === "sem_ia"
          ? "A leitura por IA não está ligada neste projeto."
          : r.estado === "limite"
            ? "Muitas leituras seguidas. Espere um minuto e tente de novo."
            : r.estado === "sem_saldo"
              ? "O saldo de IA do Lovable acabou."
              : `Não consegui ler o print: ${r.detalhe}.`,
      );
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível ler o print.")),
  });

  const salvar = useMutation({
    mutationFn: async () =>
      gravar({
        data: {
          maquinaId,
          origem: "print",
          jobs: jobs.map(({ chave: _c, areaM2: _a, ...resto }) => resto),
        },
      }),
    onSuccess: (r) => {
      toast.success(
        `${r.novas} novo(s), ${r.atualizadas} atualizado(s), ${r.iguais} já existia(m). Nada foi baixado do estoque.`,
      );
      setJobs([]);
      setRejeitadas([]);
      setImagem(null);
      void queryClient.invalidateQueries({ queryKey: ["rip-jobs-recentes"] });
      // Já procura o orçamento dos jobs novos: é só sugestão, a pessoa confirma depois.
      procurar.mutate();
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível gravar os jobs.")),
  });

  function editar(i: number, parte: Partial<Pick<JobFlexi, "nome" | "copias">>) {
    setJobs((atual) =>
      atual.map((j, k) => {
        if (k !== i) return j;
        const novo = { ...j, ...parte };
        return { ...novo, areaM2: areaM2(novo.larguraCm, novo.alturaCm, novo.copias) };
      }),
    );
  }

  const gravados = recentes.data ?? [];
  const contagem = {
    confirmados: gravados.filter((j) => vinculoDe(j)?.estado === "confirmado").length,
    sugeridos: gravados.filter((j) => vinculoDe(j)?.estado === "sugerido").length,
    revisar: gravados.filter((j) => vinculoDe(j)?.estado === "revisar").length,
    // Pai de aninhamento ("Otimizar Distribuição") nunca tem orçamento: não conta como pendente.
    sem: gravados.filter((j) => {
      const e = vinculoDe(j)?.estado;
      return !e && !/^otimizar/i.test(j.nome_job);
    }).length,
  };
  const listados = soPendentes
    ? gravados.filter((j) => {
        const e = vinculoDe(j)?.estado;
        return (!e && !/^otimizar/i.test(j.nome_job)) || e === "sugerido" || e === "revisar";
      })
    : gravados;
  const resumo = resumoDosJobs(jobs);
  const podeGravar =
    jobs.length > 0 && !!maquinaId && jobs.every((j) => j.copias >= 1 && j.nome.trim() !== "");

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <SectionHeader
        breadcrumb="Produção"
        title="Jobs do Flexi"
        description="Traga a fila do FlexiPRINT para o sistema. Nada aqui baixa estoque nem cria OS."
        ajuda="Tire um print da fila do Production Manager (com a coluna do nome bem larga), cole aqui com Ctrl+V, leia, confira as linhas e grave. Importar o mesmo job duas vezes não duplica."
      />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr]">
            <div className="space-y-2">
              <Label htmlFor="maquina">Plotter</Label>
              <Select value={maquinaId} onValueChange={setMaquinaId}>
                <SelectTrigger id="maquina">
                  <SelectValue
                    placeholder={maquinas.isLoading ? "Carregando…" : "Escolha a plotter"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(maquinas.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Print da fila</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={entrada}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void receberArquivo(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" onClick={() => entrada.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden /> Escolher imagem
                </Button>
                <span className="text-sm text-muted-foreground">ou cole com Ctrl+V</span>
              </div>
            </div>
          </div>

          {imagem ? (
            <div className="space-y-3">
              <img
                src={imagem}
                alt="Print da fila do Flexi"
                className="max-h-72 w-full rounded-md border border-border object-contain object-top"
              />
              <Button
                type="button"
                onClick={() => ler.mutate()}
                disabled={ler.isPending || !maquinaId}
              >
                <ImagePlus className="mr-2 h-4 w-4" aria-hidden />
                {ler.isPending ? "Lendo o print…" : "Ler o print"}
              </Button>
              {!maquinaId && (
                <p className="text-sm text-muted-foreground">Escolha a plotter antes de ler.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum print ainda. Cole ou escolha uma imagem.
            </p>
          )}

          {aviso && (
            <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm">
              {aviso}
            </p>
          )}
        </CardContent>
      </Card>

      {jobs.length > 0 && (
        <Card className="mt-6">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">Confira antes de gravar</h2>
              <p className="text-sm text-muted-foreground">
                {resumo.total} job(s) lido(s): {resumo.concluidos} concluído(s), {resumo.abortados}{" "}
                abortado(s), {resumo.mantendo} mantendo. {m2(resumo.areaConcluidaM2)} m² concluídos.
                Corrija o nome e as cópias se a leitura errou; o resto vem da tela.
              </p>
            </div>

            {rejeitadas.length > 0 && (
              <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm">
                {rejeitadas.length} linha(s) não entraram:{" "}
                {rejeitadas.map((r) => `linha ${r.indice + 1} (${r.motivo})`).join(", ")}. Confira o
                print e leia de novo.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Nome</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Medida (cm)</th>
                    <th className="py-2 pr-3 font-medium">Cópias</th>
                    <th className="py-2 pr-3 text-right font-medium">m²</th>
                    <th className="py-2 pr-3 font-medium">Saída</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j, i) => (
                    <tr key={j.chave} className="border-b border-border/60 align-middle">
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Nome da linha ${i + 1}`}
                          value={j.nome}
                          onChange={(e) => editar(i, { nome: e.target.value })}
                          className={j.aninhado ? "ml-4 w-[calc(100%-1rem)]" : undefined}
                        />
                      </td>
                      <td className="py-2 pr-3">{STATUS_ROTULO[j.status]}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {j.larguraCm.toLocaleString("pt-BR")} × {j.alturaCm.toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Cópias da linha ${i + 1}`}
                          type="number"
                          min={1}
                          value={j.copias}
                          onChange={(e) =>
                            editar(i, {
                              copias: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            })
                          }
                          className="w-20"
                        />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m2(j.areaM2)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatoData.format(new Date(j.impressoEm))}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Tirar a linha ${i + 1}`}
                          onClick={() => setJobs((atual) => atual.filter((_, k) => k !== i))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => salvar.mutate()}
                disabled={!podeGravar || salvar.isPending}
              >
                {salvar.isPending ? "Gravando…" : `Gravar ${jobs.length} job(s)`}
              </Button>
              <span className="text-sm text-muted-foreground">
                Grava só o fato da impressão e já procura o orçamento de cada job. Quem confirma é
                você, mais abaixo; a baixa de bobina vem depois.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Últimos jobs importados</h2>
              <p className="text-sm text-muted-foreground">
                {contagem.confirmados} com orçamento confirmado · {contagem.sugeridos} sugerido(s) ·{" "}
                {contagem.revisar} para escolher · {contagem.sem} sem orçamento ligado. Confirmar
                não baixa estoque.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={soPendentes}
                  onChange={(e) => setSoPendentes(e.target.checked)}
                />
                Só os que faltam conferir
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => procurar.mutate()}
                disabled={procurar.isPending}
              >
                <Search className="mr-2 h-4 w-4" aria-hidden />
                {procurar.isPending ? "Procurando…" : "Procurar orçamentos"}
              </Button>
            </div>
          </div>
          {recentes.isLoading ? (
            <Carregando />
          ) : recentes.error ? (
            <p role="alert" className="text-sm">
              {mensagemErro(recentes.error, "Não foi possível ler os jobs importados.")}
            </p>
          ) : (recentes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum job importado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Saída</th>
                    <th className="py-2 pr-3 font-medium">Nome</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Medida (cm)</th>
                    <th className="py-2 pr-3 text-right font-medium">Cópias</th>
                    <th className="py-2 pr-3 text-right font-medium">m²</th>
                    <th className="py-2 font-medium">Orçamento</th>
                  </tr>
                </thead>
                <tbody>
                  {listados.map((j) => (
                    <tr key={j.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatoData.format(new Date(j.impresso_em))}
                      </td>
                      <td className="py-2 pr-3">
                        {j.aninhado ? "↳ " : ""}
                        {j.nome_job}
                      </td>
                      <td className="py-2 pr-3">{STATUS_ROTULO[j.status_flexi]}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {Number(j.largura_cm).toLocaleString("pt-BR")} ×{" "}
                        {Number(j.altura_cm).toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{j.copias}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m2(Number(j.area_m2))}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          className={`text-left ${TOM_DO_VINCULO[rotuloDoVinculo(vinculoDe(j)).tom]}`}
                          onClick={() => setConferindo({ ...j, vinculo: vinculoDe(j) })}
                          aria-label={`Conferir o orçamento do job ${j.nome_job}`}
                        >
                          {rotuloDoVinculo(vinculoDe(j)).texto}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConferirJobDialog job={conferindo} onFechar={() => setConferindo(null)} />
    </div>
  );
}
