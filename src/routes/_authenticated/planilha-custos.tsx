/* eslint-disable @typescript-eslint/no-explicit-any */
import { hojeBr } from "@/lib/hoje-br";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { deCSV, escreverNumero, lerNumero, paraCSV } from "@/domain/custos/planilha-csv";
import { AvisoDeFalhaDeConsulta } from "@/components/custos/aviso-de-falha-de-consulta";
import {
  LIMITE_DE_ENCARGOS_EM_PORCENTAGEM,
  custoVigenteDoMaterial,
  decidirCampo,
  decidirEncargos,
  fracaoParaPorcentagem,
  horaCheia,
  textoDaFonteDoCusto,
  textoDoValor,
} from "@/domain/custos/campo-de-custo";
import { AlertTriangle, Download, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planilha-custos")({
  head: () => ({ meta: [{ title: "Planilha de custos — BEX PRINT OS" }] }),
  component: PlanilhaPage,
});

const brl = (n: number | null | undefined) =>
  n == null ? "Sem valor" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Nome novo de propósito: arquivo antigo, que trazia fração arredondada, não reaparece como se fosse porcentagem. */
const COLUNA_DE_ENCARGOS = "encargos_percentual";

function baixar(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Planilha de custos: tarifa de energia, mão de obra e custo de material num
 * lugar só, com ida e volta por CSV.
 *
 * Antes esses números moravam em três telas que não se falam. Atualizar preço de
 * fornecedor virava caça ao tesouro, e o que não fosse achado continuava orçando
 * com o custo do ano passado — sem avisar ninguém.
 *
 * O CSV existe porque é assim que fornecedor manda tabela: uma planilha. Digitar
 * 17 materiais à mão a cada reajuste é como o custo envelhece.
 */
function PlanilhaPage() {
  const qc = useQueryClient();
  const { hasPermission, canSeeFinancials } = useAuth();
  const podeEditar = hasPermission("custos.update") || hasPermission("estoque.adjust");
  // Mão de obra é a tabela de custos, não o estoque: o banco pede custos.update
  // (migração 20261005100000). Quem ajusta estoque continua mudando o custo do
  // material aqui, mas não o custo/hora das pessoas.
  const podeEditarMaoDeObra = hasPermission("custos.update");
  const [importando, setImportando] = useState(false);
  const arquivoMaterial = useRef<HTMLInputElement>(null);
  const arquivoMaoObra = useRef<HTMLInputElement>(null);

  const {
    data: materiais = [],
    isPending: materiaisPendentes,
    isError: materiaisFalharam,
    error: erroDosMateriais,
    isFetching: buscandoMateriais,
    refetch: lerMateriaisDeNovo,
  } = useQuery({
    queryKey: ["planilha-materiais"],
    queryFn: async () => {
      // A view financeira é a via oficial do custo: a tabela `materiais` não
      // expõe custo_unitario nem para quem pode vê-lo.
      const { data, error } = await (supabase as any)
        .from("materiais_financeiro")
        .select("id, nome, unidade, custo_unitario, custo_medio, estoque, fornecedor")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: maoDeObra = [],
    isPending: maoDeObraPendente,
    isError: maoDeObraFalhou,
    error: erroDaMaoDeObra,
    isFetching: buscandoMaoDeObra,
    refetch: lerMaoDeObraDeNovo,
  } = useQuery({
    queryKey: ["planilha-mao-obra"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("custos_mao_de_obra")
        .select("id, funcao, setor, custo_hora, encargos_pct, ativo")
        .order("funcao");
      if (error) throw error;
      return data ?? [];
    },
  });

  // As tarifas e margens da impressão 3D. Depois da onda C3 só quem vê custo de máquina (admin, gestor, financeiro)
  // lê esta linha: o estoque, que abre esta planilha por custos.read, recebe nada. A aba diz isso em vez de ficar
  // vazia, e falha de leitura aparece como falha.
  const {
    data: config,
    isPending: configPendente,
    isError: configFalhou,
    error: erroDaConfig,
    isFetching: configBuscando,
    refetch: lerConfigDeNovo,
  } = useQuery({
    queryKey: ["planilha-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("config_precificacao_3d")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  // O que mudou de preço e ainda não chegou às OS abertas.
  const {
    data: desatualizadas = [],
    isError: desatualizadasFalharam,
    error: erroDasDesatualizadas,
    isFetching: buscandoDesatualizadas,
    refetch: lerDesatualizadasDeNovo,
  } = useQuery({
    queryKey: ["previsoes-desatualizadas"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("previsoes_desatualizadas");
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvarMaterial = useMutation({
    mutationFn: async ({ id, custo }: { id: string; custo: number }) => {
      const { data, error } = await (supabase as any)
        .from("materiais")
        .update({ custo_unitario: custo })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // RLS barra escrita devolvendo 0 linhas e nenhum erro.
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não pode alterar custo de material.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planilha-materiais"] });
      qc.invalidateQueries({ queryKey: ["previsoes-desatualizadas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarMaoObra = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: string; valor: number }) => {
      const { data, error } = await (supabase as any)
        .from("custos_mao_de_obra")
        .update({ [campo]: valor })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar custo de mão de obra.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha-mao-obra"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarConfig = useMutation({
    mutationFn: async ({ campo, valor }: { campo: string; valor: number }) => {
      const { data, error } = await (supabase as any)
        .from("config_precificacao_3d")
        .update({ [campo]: valor })
        .eq("id", config.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar as tarifas.");
    },
    onSuccess: () => {
      toast.success("Tarifa atualizada");
      qc.invalidateQueries({ queryKey: ["planilha-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repassar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("recalcular_previsao_custos", {
        p_os_id: null,
      });
      if (error) throw error;
      return data as { linhas_atualizadas: number; os_afetadas: number };
    },
    onSuccess: (r) => {
      toast.success(
        r.linhas_atualizadas === 0
          ? "Nada a repassar — as OS abertas já usam o custo atual."
          : `${r.linhas_atualizadas} previsões atualizadas em ${r.os_afetadas} OS.`,
      );
      qc.invalidateQueries({ queryKey: ["previsoes-desatualizadas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function exportarMateriais() {
    baixar(
      `materiais-${hojeBr()}.csv`,
      paraCSV(
        ["id", "nome", "unidade", "custo_unitario", "fornecedor"],
        materiais.map((m: any) => ({
          id: m.id,
          nome: m.nome,
          unidade: m.unidade ?? "",
          custo_unitario: escreverNumero(m.custo_unitario, 4),
          fornecedor: m.fornecedor ?? "",
        })),
      ),
    );
  }

  function exportarMaoObra() {
    baixar(
      `mao-de-obra-${hojeBr()}.csv`,
      paraCSV(
        ["id", "funcao", "setor", "custo_hora", COLUNA_DE_ENCARGOS],
        maoDeObra.map((m: any) => ({
          id: m.id,
          funcao: m.funcao,
          setor: m.setor ?? "",
          custo_hora: escreverNumero(m.custo_hora, 2),
          // Em porcentagem, como na tela: 32,82 e não 0,3282.
          [COLUNA_DE_ENCARGOS]: escreverNumero(fracaoParaPorcentagem(m.encargos_pct), 2),
        })),
      ),
    );
  }

  /**
   * A importação casa por `id` quando o arquivo veio da exportação, e por NOME
   * quando veio do fornecedor. Sem o casamento por nome, a planilha que o
   * fornecedor manda seria inútil — e é justamente ela que traz o reajuste.
   */
  async function importar(
    arquivo: File,
    tipo: "material" | "mao_de_obra",
  ): Promise<void> {
    setImportando(true);
    try {
      const linhas = deCSV(await arquivo.text());
      if (linhas.length === 0) throw new Error("Arquivo vazio ou sem cabeçalho.");

      const alvo: any[] = tipo === "material" ? materiais : maoDeObra;
      const chaveNome = tipo === "material" ? "nome" : "funcao";

      type Mudanca = { id: string; campo: string; valor: number; nome: string };
      const aplicar: Mudanca[] = [];
      const ignoradas: string[] = [];

      for (const linha of linhas) {
        const nome = (linha[chaveNome] ?? "").trim();
        const registro =
          alvo.find((a) => a.id === linha.id) ??
          alvo.find((a) => String(a[chaveNome]).toLowerCase() === nome.toLowerCase());
        if (!registro) {
          if (nome) ignoradas.push(nome);
          continue;
        }
        const colunas =
          tipo === "material"
            ? [{ coluna: "custo_unitario", campo: "custo_unitario", encargos: false }]
            : [
                { coluna: "custo_hora", campo: "custo_hora", encargos: false },
                // Só lê encargos se o arquivo trouxe a coluna: arquivo de fornecedor não precisa dela.
                ...(COLUNA_DE_ENCARGOS in linha
                  ? [{ coluna: COLUNA_DE_ENCARGOS, campo: "encargos_pct", encargos: true }]
                  : []),
              ];
        for (const c of colunas) {
          // `null` é "não consegui ler", e é diferente de zero. Gravar zero aqui
          // faria o material passar a custar nada.
          const valor = lerNumero(linha[c.coluna]);
          if (valor == null || valor < 0) {
            ignoradas.push(`${nome} (${c.encargos ? "encargos" : "custo"} ilegível)`);
            continue;
          }
          if (c.encargos) {
            const d = decidirEncargos(linha[c.coluna], registro.encargos_pct);
            if (d.acao === "recusar") {
              ignoradas.push(`${nome} (encargos acima de ${LIMITE_DE_ENCARGOS_EM_PORCENTAGEM} %)`);
            } else if (d.acao === "gravar") {
              aplicar.push({ id: registro.id, campo: c.campo, valor: d.valor, nome: registro[chaveNome] });
            }
            continue;
          }
          if (Number(registro[c.campo]) === valor) continue;
          aplicar.push({ id: registro.id, campo: c.campo, valor, nome: registro[chaveNome] });
        }
      }

      if (aplicar.length === 0) {
        toast.info(
          ignoradas.length > 0
            ? `Nada a mudar. Não reconheci: ${ignoradas.slice(0, 5).join(", ")}${ignoradas.length > 5 ? " e outros" : ""}`
            : "Nada a mudar. Os custos do arquivo são iguais aos atuais.",
        );
        return;
      }

      for (const item of aplicar) {
        if (tipo === "material") {
          await salvarMaterial.mutateAsync({ id: item.id, custo: item.valor });
        } else {
          await salvarMaoObra.mutateAsync({ id: item.id, campo: item.campo, valor: item.valor });
        }
      }

      toast.success(
        `${aplicar.length} valores atualizados.` +
          (ignoradas.length > 0 ? ` ${ignoradas.length} linhas ignoradas.` : ""),
      );
      qc.invalidateQueries({ queryKey: ["previsoes-desatualizadas"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar");
    } finally {
      setImportando(false);
    }
  }

  const totalDivergencia = desatualizadas.reduce(
    (s: number, d: any) => s + Number(d.diferenca ?? 0),
    0,
  );

  /** Campo apagado ou recusado volta ao valor anterior na tela; só número digitado vira gravação. */
  function aoSairDoCampo(
    e: React.FocusEvent<HTMLInputElement>,
    atual: number | null | undefined,
    gravar: (valor: number) => void,
  ) {
    const d = decidirCampo(e.target.value, atual);
    if (d.acao === "gravar") gravar(d.valor);
    else {
      if (d.acao === "recusar") toast.error(d.mensagem);
      e.target.value = textoDoValor(atual);
    }
  }

  if (!canSeeFinancials) {
    return (
      <div>
        <SectionHeader breadcrumb="Custeio · Planilha de custos" title="Planilha de custos" />
        <Card>
          <CardContent className="p-6 text-base">
            Esta tela mostra custo de compra e mão de obra. Seu perfil não tem acesso a valores.
          </CardContent>
        </Card>
      </div>
    );
  }

  const campoDeCusto = "ml-auto h-11 text-right font-mono text-base md:text-base";

  return (
    <div className="text-base">
      <SectionHeader
        breadcrumb="Custeio · Planilha de custos"
        title="Planilha de custos"
        description="Tarifa de energia, mão de obra e custo de material num lugar só. É o que alimenta orçamento e OS."
      />

      {desatualizadasFalharam && (
        <div className="mb-4">
          <AvisoDeFalhaDeConsulta
            o_que="as previsões desatualizadas"
            erro={erroDasDesatualizadas}
            carregando={buscandoDesatualizadas}
            aoTentarDeNovo={() => void lerDesatualizadasDeNovo()}
          />
        </div>
      )}

      {desatualizadas.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-base">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              <strong>{desatualizadas.length}</strong> previsões de material em OS abertas
              usam um custo que mudou, com diferença de {brl(totalDivergencia)}. OS fechada não é
              tocada, e material já reservado ou baixado tem preço travado no lote.
              {podeEditar && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" className="h-11 min-h-11 text-base" disabled={repassar.isPending}
                          onClick={() => repassar.mutate()}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    {repassar.isPending ? "Repassando" : "Repassar para as OS abertas"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="materiais">
        <TabsList>
          <TabsTrigger value="materiais" className="text-base">Materiais</TabsTrigger>
          <TabsTrigger value="mao-obra" className="text-base">Mão de obra</TabsTrigger>
          <TabsTrigger value="tarifas" className="text-base">Tarifas e margens</TabsTrigger>
        </TabsList>

        <TabsContent value="materiais" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base font-medium">
                Custo por unidade: {materiaisFalharam ? "sem leitura" : `${materiais.length} materiais`}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-11 min-h-11 text-base" onClick={exportarMateriais} disabled={materiaisFalharam}>
                  <Download className="mr-1 h-4 w-4" /> Exportar CSV
                </Button>
                {podeEditar && (
                  <>
                    <input
                      ref={arquivoMaterial}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importar(f, "material");
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" variant="outline" className="h-11 min-h-11 text-base" disabled={importando || materiaisFalharam}
                            onClick={() => arquivoMaterial.current?.click()}>
                      <Upload className="mr-1 h-4 w-4" />
                      {importando ? "Importando" : "Importar CSV"}
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              {materiaisPendentes && <Carregando linhas={3} />}
              {materiaisFalharam && (
                <AvisoDeFalhaDeConsulta
                  o_que="os materiais"
                  erro={erroDosMateriais}
                  carregando={buscandoMateriais}
                  aoTentarDeNovo={() => void lerMateriaisDeNovo()}
                />
              )}
              {!materiaisPendentes && !materiaisFalharam && materiais.length === 0 && (
                <p className="p-4 text-base" data-testid="materiais-vazios">
                  Nenhum material cadastrado.
                </p>
              )}
              {!materiaisPendentes && !materiaisFalharam && materiais.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-base">Material</TableHead>
                      <TableHead className="text-base">Unidade</TableHead>
                      <TableHead className="text-right text-base">Custo nas contas</TableHead>
                      <TableHead className="text-right text-base">Última compra</TableHead>
                      <TableHead className="text-right text-base">Custo médio</TableHead>
                      <TableHead className="text-right text-base">Estoque</TableHead>
                      <TableHead className="text-base">Fornecedor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materiais.map((m: any) => {
                      const vigente = custoVigenteDoMaterial(m);
                      const destaque = "rounded-md bg-primary/10 ring-2 ring-primary";
                      return (
                      <TableRow key={m.id}>
                        <TableCell className="text-base font-medium">{m.nome}</TableCell>
                        <TableCell className="text-base">{m.unidade}</TableCell>
                        <TableCell className="text-right" data-testid={`custo-vigente-${m.id}`}>
                          <span className="font-mono text-base font-semibold">{brl(vigente.valor)}</span>
                          <span className="block text-base">{textoDaFonteDoCusto(vigente.origem)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className={vigente.origem === "ultima_compra" ? destaque : undefined}>
                          {podeEditar ? (
                            <Input
                              key={`${m.id}-${m.custo_unitario}`}
                              type="number"
                              step="0.0001"
                              min="0"
                              defaultValue={Number(m.custo_unitario ?? 0)}
                              aria-label={`Custo da última compra de ${m.nome}`}
                              className={`${campoDeCusto} w-32`}
                              onBlur={(e) =>
                                aoSairDoCampo(e, m.custo_unitario == null ? null : Number(m.custo_unitario), (v) =>
                                  salvarMaterial.mutate({ id: m.id, custo: v }),
                                )
                              }
                            />
                          ) : (
                            <span className="font-mono text-base">{brl(m.custo_unitario)}</span>
                          )}
                          {vigente.origem === "medio" && (
                            <span className="block text-base">não muda o custo</span>
                          )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className={vigente.origem === "medio" || (vigente.origem === "nenhum" && m.custo_medio != null) ? destaque : undefined}>
                            <span className="font-mono text-base">{brl(m.custo_medio)}</span>
                            <span className="block text-base">calculado nas compras</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-base">
                          {Number(m.estoque ?? 0) === 0 ? (
                            <span>zerado</span>
                          ) : (
                            `${Number(m.estoque).toLocaleString("pt-BR")} ${m.unidade}`
                          )}
                        </TableCell>
                        <TableCell className="text-base">
                          {m.fornecedor || "Sem fornecedor"}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-base" data-testid="nota-do-custo-vigente">
            O banco calcula o custo dos produtos com o custo médio quando ele existe, e só usa o valor
            da última compra quando o médio está sem valor. A coluna Custo nas contas mostra o valor
            usado e de onde ele vem. O custo médio é calculado a cada compra, por isso não se digita
            aqui: um valor digitado seria apagado na próxima entrada de material. Mudar a última
            compra de um material que usa o custo médio não muda o custo do produto.
          </p>
          <p className="mt-2 text-base">
            A importação casa por <code>id</code> quando o arquivo veio daqui, e por nome quando
            veio do fornecedor. Linha com custo ilegível é ignorada e listada. Ela nunca vira zero.
          </p>
        </TabsContent>

        <TabsContent value="mao-obra" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base font-medium">
                Custo por hora: {maoDeObraFalhou ? "sem leitura" : `${maoDeObra.length} funções`}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-11 min-h-11 text-base" onClick={exportarMaoObra} disabled={maoDeObraFalhou}>
                  <Download className="mr-1 h-4 w-4" /> Exportar CSV
                </Button>
                {podeEditarMaoDeObra && (
                  <>
                    <input
                      ref={arquivoMaoObra}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importar(f, "mao_de_obra");
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" variant="outline" className="h-11 min-h-11 text-base" disabled={importando || maoDeObraFalhou}
                            onClick={() => arquivoMaoObra.current?.click()}>
                      <Upload className="mr-1 h-4 w-4" /> Importar CSV
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              {maoDeObraPendente && <Carregando linhas={3} />}
              {maoDeObraFalhou && (
                <AvisoDeFalhaDeConsulta
                  o_que="as funções da mão de obra"
                  erro={erroDaMaoDeObra}
                  carregando={buscandoMaoDeObra}
                  aoTentarDeNovo={() => void lerMaoDeObraDeNovo()}
                />
              )}
              {!maoDeObraPendente && !maoDeObraFalhou && maoDeObra.length === 0 && (
                <p className="p-4 text-base" data-testid="mao-de-obra-vazia">
                  Nenhuma função cadastrada. Cadastre em Custos fixos e mão de obra.
                </p>
              )}
              {!maoDeObraPendente && !maoDeObraFalhou && maoDeObra.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-base">Função</TableHead>
                    <TableHead className="text-base">Setor</TableHead>
                    <TableHead className="text-right text-base">Custo por hora</TableHead>
                    <TableHead className="text-right text-base">Encargos em %</TableHead>
                    <TableHead className="text-right text-base">Hora cheia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maoDeObra.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-base font-medium">{m.funcao}</TableCell>
                      <TableCell className="text-base">{m.setor || "Sem setor"}</TableCell>
                      <TableCell className="text-right">
                        {podeEditarMaoDeObra ? (
                          <Input key={`${m.id}-${m.custo_hora}`} type="number" step="0.01" min="0"
                                 defaultValue={Number(m.custo_hora ?? 0)}
                                 aria-label={`Custo por hora de ${m.funcao}`}
                                 className={`${campoDeCusto} w-28`}
                                 onBlur={(e) =>
                                   aoSairDoCampo(e, m.custo_hora == null ? null : Number(m.custo_hora), (v) =>
                                     salvarMaoObra.mutate({ id: m.id, campo: "custo_hora", valor: v }),
                                   )
                                 } />
                        ) : (
                          <span className="font-mono text-base">{brl(m.custo_hora)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeEditarMaoDeObra ? (
                          <Input key={`${m.id}-${m.encargos_pct}`} type="number" step="0.01" min="0"
                                 max={LIMITE_DE_ENCARGOS_EM_PORCENTAGEM}
                                 defaultValue={fracaoParaPorcentagem(m.encargos_pct)}
                                 aria-label={`Encargos de ${m.funcao}, em porcentagem`}
                                 className={`${campoDeCusto} w-28`}
                                 onBlur={(e) => {
                                   const d = decidirEncargos(e.target.value, m.encargos_pct);
                                   if (d.acao === "gravar") {
                                     salvarMaoObra.mutate({ id: m.id, campo: "encargos_pct", valor: d.valor });
                                   } else {
                                     if (d.acao === "recusar") toast.error(d.mensagem);
                                     e.target.value = textoDoValor(fracaoParaPorcentagem(m.encargos_pct));
                                   }
                                 }} />
                        ) : (
                          <span className="font-mono text-base">
                            {fracaoParaPorcentagem(m.encargos_pct).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} %
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-base">
                        {brl(horaCheia(m.custo_hora, m.encargos_pct))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-base">
            Hora cheia é o custo por hora vezes um mais os encargos. É ela que entra no orçamento, não o
            salário por hora. Digite os encargos em porcentagem: 32,82 para 32,82 %. O máximo é 100 %.
          </p>
          {!podeEditarMaoDeObra && (
            <p className="mt-1 text-base">
              Mudar o custo da mão de obra pede a permissão de alterar custos.
            </p>
          )}
        </TabsContent>

        <TabsContent value="tarifas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Tarifas e margens da impressão 3D</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {configPendente && <Carregando linhas={3} className="sm:col-span-2 lg:col-span-3" />}
              {configFalhou && (
                <div className="sm:col-span-2 lg:col-span-3" data-testid="tarifas-3d-falhou">
                  <AvisoDeFalhaDeConsulta
                    o_que="as tarifas e margens"
                    erro={erroDaConfig}
                    carregando={configBuscando}
                    aoTentarDeNovo={() => void lerConfigDeNovo()}
                  />
                </div>
              )}
              {!configPendente && !configFalhou && !config && (
                <div className="space-y-1 sm:col-span-2 lg:col-span-3" data-testid="tarifas-3d-sem-acesso">
                  <p className="text-base font-medium">As tarifas e margens da impressão 3D não chegaram para o seu perfil.</p>
                  <p className="text-base">
                    Elas ficam com quem vê custo de máquina, que é a gerência e o financeiro. Se a base nunca foi cadastrada, cadastre em
                    Configurações 3D.
                  </p>
                </div>
              )}
              {config &&
                [
                  { campo: "tarifa_kwh_padrao", rotulo: "Energia em R$ por kWh", passo: "0.0001",
                    nota: "com tributos e bandeira" },
                  { campo: "mo_custo_hora_padrao", rotulo: "Mão de obra padrão em R$ por hora", passo: "0.01",
                    nota: "usado quando a função não tem custo próprio" },
                  { campo: "mo_encargos_pct", rotulo: "Encargos em %", passo: "0.01",
                    nota: "nesta tabela o valor já é em porcentagem, por exemplo 32,19" },
                  { campo: "markup_padrao", rotulo: "Markup padrão, em multiplicador", passo: "0.01",
                    nota: "multiplica o custo operacional" },
                  { campo: "markup_atacado_padrao", rotulo: "Markup atacado, em multiplicador", passo: "0.01", nota: "" },
                  { campo: "pct_acabamento_padrao", rotulo: "Acabamento em %", passo: "0.01", nota: "" },
                  { campo: "pct_falha_padrao", rotulo: "Reserva de falha em %", passo: "0.01",
                    nota: "peça que sai errada e precisa refazer" },
                  { campo: "custo_admin_padrao", rotulo: "Embalagem sugerida em R$", passo: "0.01",
                    nota: "opcional; só soma quando Cobrar embalagem estiver marcado, uma vez por item 3D" },
                ].map((c) => {
                  const vazio = Number(config[c.campo] ?? 0) === 0;
                  return (
                    <div key={c.campo}>
                      <Label htmlFor={c.campo} className="text-base">
                        {c.rotulo}
                        {vazio && (
                          <Badge variant="outline" className="ml-2 text-base font-normal text-amber-700 dark:text-amber-400">
                            zerado
                          </Badge>
                        )}
                      </Label>
                      <Input
                        key={`${c.campo}-${config[c.campo]}`}
                        id={c.campo}
                        type="number"
                        step={c.passo}
                        min="0"
                        disabled={!podeEditar}
                        defaultValue={Number(config[c.campo] ?? 0)}
                        className="h-11 font-mono text-base md:text-base"
                        onBlur={(e) =>
                          aoSairDoCampo(e, config[c.campo] == null ? null : Number(config[c.campo]), (v) =>
                            salvarConfig.mutate({ campo: c.campo, valor: v }),
                          )
                        }
                      />
                      {c.nota && <p className="mt-1 text-base">{c.nota}</p>}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
          <p className="mt-2 text-base">
            Estas tarifas são só da impressão 3D. Mão de obra, markup e rateio dos produtos comuns ficam em
            Custos fixos e mão de obra, nos parâmetros da casa. Campo zerado não é de graça, é
            ninguém preencheu, e o cálculo trata os dois igual. Apagar um campo e sair dele devolve o valor
            anterior, sem gravar zero.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
