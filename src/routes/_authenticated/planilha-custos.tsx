/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { deCSV, escreverNumero, lerNumero, paraCSV } from "@/domain/custos/planilha-csv";
import { AlertTriangle, Download, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planilha-custos")({
  head: () => ({ meta: [{ title: "Planilha de custos — BEX PRINT OS" }] }),
  component: PlanilhaPage,
});

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
  const [importando, setImportando] = useState(false);
  const arquivoMaterial = useRef<HTMLInputElement>(null);
  const arquivoMaoObra = useRef<HTMLInputElement>(null);

  const { data: materiais = [] } = useQuery({
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

  const { data: maoDeObra = [] } = useQuery({
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

  const { data: config } = useQuery({
    queryKey: ["planilha-config"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("config_precificacao_3d")
        .select("*")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // O que mudou de preço e ainda não chegou às OS abertas.
  const { data: desatualizadas = [] } = useQuery({
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
      `materiais-${new Date().toISOString().slice(0, 10)}.csv`,
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
      `mao-de-obra-${new Date().toISOString().slice(0, 10)}.csv`,
      paraCSV(
        ["id", "funcao", "setor", "custo_hora", "encargos_pct"],
        maoDeObra.map((m: any) => ({
          id: m.id,
          funcao: m.funcao,
          setor: m.setor ?? "",
          custo_hora: escreverNumero(m.custo_hora, 2),
          encargos_pct: escreverNumero(m.encargos_pct, 2),
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
      const chaveCusto = tipo === "material" ? "custo_unitario" : "custo_hora";

      const aplicar: { id: string; valor: number; nome: string; antes: number }[] = [];
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
        const valor = lerNumero(linha[chaveCusto]);
        // `null` é "não consegui ler", e é diferente de zero. Gravar zero aqui
        // faria o material passar a custar nada.
        if (valor == null || valor < 0) {
          ignoradas.push(`${nome} (custo ilegível)`);
          continue;
        }
        if (Number(registro[chaveCusto]) === valor) continue;
        aplicar.push({ id: registro.id, valor, nome: registro[chaveNome], antes: Number(registro[chaveCusto]) });
      }

      if (aplicar.length === 0) {
        toast.info(
          ignoradas.length > 0
            ? `Nada a mudar. Não reconheci: ${ignoradas.slice(0, 5).join(", ")}${ignoradas.length > 5 ? "…" : ""}`
            : "Nada a mudar — os custos do arquivo são iguais aos atuais.",
        );
        return;
      }

      for (const item of aplicar) {
        if (tipo === "material") {
          await salvarMaterial.mutateAsync({ id: item.id, custo: item.valor });
        } else {
          await salvarMaoObra.mutateAsync({ id: item.id, campo: "custo_hora", valor: item.valor });
        }
      }

      toast.success(
        `${aplicar.length} custo(s) atualizado(s).` +
          (ignoradas.length > 0 ? ` ${ignoradas.length} linha(s) ignorada(s).` : ""),
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

  if (!canSeeFinancials) {
    return (
      <div>
        <SectionHeader breadcrumb="Custos" title="Planilha de custos" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Esta tela mostra custo de compra e mão de obra. Seu perfil não tem acesso a valores.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        breadcrumb="Custos"
        title="Planilha de custos"
        description="Tarifa de energia, mão de obra e custo de material num lugar só — o que alimenta orçamento e OS."
      />

      {desatualizadas.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              <strong>{desatualizadas.length}</strong> previsão(ões) de material em OS abertas
              usam um custo que mudou — diferença de {brl(totalDivergencia)}. OS fechada não é
              tocada, e material já reservado ou baixado tem preço travado no lote.
              {podeEditar && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" disabled={repassar.isPending}
                          onClick={() => repassar.mutate()}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    {repassar.isPending ? "Repassando…" : "Repassar para as OS abertas"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="materiais">
        <TabsList>
          <TabsTrigger value="materiais">Materiais</TabsTrigger>
          <TabsTrigger value="mao-obra">Mão de obra</TabsTrigger>
          <TabsTrigger value="tarifas">Tarifas e margens</TabsTrigger>
        </TabsList>

        <TabsContent value="materiais" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-sm font-medium">
                Custo por unidade ({materiais.length})
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportarMateriais}>
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
                    <Button size="sm" variant="outline" disabled={importando}
                            onClick={() => arquivoMaterial.current?.click()}>
                      <Upload className="mr-1 h-4 w-4" />
                      {importando ? "Importando…" : "Importar CSV"}
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Custo por unidade</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead>Fornecedor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materiais.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.nome}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.unidade}</TableCell>
                        <TableCell className="text-right">
                          {podeEditar ? (
                            <Input
                              type="number"
                              step="0.0001"
                              min="0"
                              defaultValue={Number(m.custo_unitario ?? 0)}
                              className="ml-auto h-8 w-32 text-right font-mono"
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== Number(m.custo_unitario)) {
                                  salvarMaterial.mutate({ id: m.id, custo: v });
                                }
                              }}
                            />
                          ) : (
                            <span className="font-mono">{brl(m.custo_unitario)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {Number(m.estoque ?? 0) === 0 ? (
                            <span className="text-muted-foreground">zerado</span>
                          ) : (
                            `${Number(m.estoque).toLocaleString("pt-BR")} ${m.unidade}`
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.fornecedor || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            A importação casa por <code>id</code> quando o arquivo veio daqui, e por nome quando
            veio do fornecedor. Linha com custo ilegível é ignorada e listada — nunca vira zero.
          </p>
        </TabsContent>

        <TabsContent value="mao-obra" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-sm font-medium">Custo por hora ({maoDeObra.length})</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportarMaoObra}>
                  <Download className="mr-1 h-4 w-4" /> Exportar CSV
                </Button>
                {podeEditar && (
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
                    <Button size="sm" variant="outline" disabled={importando}
                            onClick={() => arquivoMaoObra.current?.click()}>
                      <Upload className="mr-1 h-4 w-4" /> Importar CSV
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Função</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead className="text-right">Custo/hora</TableHead>
                    <TableHead className="text-right">Encargos %</TableHead>
                    <TableHead className="text-right">Hora cheia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maoDeObra.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.funcao}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.setor || "—"}</TableCell>
                      <TableCell className="text-right">
                        {podeEditar ? (
                          <Input type="number" step="0.01" min="0"
                                 defaultValue={Number(m.custo_hora ?? 0)}
                                 className="ml-auto h-8 w-28 text-right font-mono"
                                 onBlur={(e) => {
                                   const v = Number(e.target.value);
                                   if (Number.isFinite(v) && v !== Number(m.custo_hora)) {
                                     salvarMaoObra.mutate({ id: m.id, campo: "custo_hora", valor: v });
                                   }
                                 }} />
                        ) : (
                          <span className="font-mono">{brl(m.custo_hora)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeEditar ? (
                          <Input type="number" step="0.01" min="0"
                                 defaultValue={Number(m.encargos_pct ?? 0)}
                                 className="ml-auto h-8 w-24 text-right font-mono"
                                 onBlur={(e) => {
                                   const v = Number(e.target.value);
                                   if (Number.isFinite(v) && v !== Number(m.encargos_pct)) {
                                     salvarMaoObra.mutate({ id: m.id, campo: "encargos_pct", valor: v });
                                   }
                                 }} />
                        ) : (
                          <span className="font-mono">{Number(m.encargos_pct ?? 0)}%</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {brl(Number(m.custo_hora ?? 0) * (1 + Number(m.encargos_pct ?? 0) / 100))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            “Hora cheia” é o custo com encargos — é ele que entra no orçamento, não o salário/hora.
          </p>
        </TabsContent>

        <TabsContent value="tarifas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Tarifas e margens</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {config &&
                [
                  { campo: "tarifa_kwh_padrao", rotulo: "Energia (R$/kWh)", passo: "0.0001",
                    nota: "com tributos e bandeira" },
                  { campo: "mo_custo_hora_padrao", rotulo: "Mão de obra padrão (R$/h)", passo: "0.01",
                    nota: "usado quando a função não tem custo próprio" },
                  { campo: "mo_encargos_pct", rotulo: "Encargos (%)", passo: "0.01", nota: "" },
                  { campo: "markup_padrao", rotulo: "Markup padrão", passo: "0.01",
                    nota: "multiplica o custo operacional" },
                  { campo: "markup_atacado_padrao", rotulo: "Markup atacado", passo: "0.01", nota: "" },
                  { campo: "pct_acabamento_padrao", rotulo: "Acabamento (%)", passo: "0.01", nota: "" },
                  { campo: "pct_falha_padrao", rotulo: "Reserva de falha (%)", passo: "0.01",
                    nota: "peça que sai errada e precisa refazer" },
                  { campo: "custo_admin_padrao", rotulo: "Custo admin (R$)", passo: "0.01",
                    nota: "rateio fixo por peça" },
                ].map((c) => {
                  const vazio = Number(config[c.campo] ?? 0) === 0;
                  return (
                    <div key={c.campo}>
                      <Label htmlFor={c.campo} className="text-xs">
                        {c.rotulo}
                        {vazio && (
                          <Badge variant="outline" className="ml-2 font-normal text-amber-600">
                            zerado
                          </Badge>
                        )}
                      </Label>
                      <Input
                        id={c.campo}
                        type="number"
                        step={c.passo}
                        min="0"
                        disabled={!podeEditar}
                        defaultValue={Number(config[c.campo] ?? 0)}
                        className="font-mono"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== Number(config[c.campo])) {
                            salvarConfig.mutate({ campo: c.campo, valor: v });
                          }
                        }}
                      />
                      {c.nota && <p className="mt-1 text-xs text-muted-foreground">{c.nota}</p>}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Campo zerado não é “de graça”, é “ninguém preencheu” — e o cálculo trata os dois igual.
            O custo admin em zero, por exemplo, tira o rateio fixo de toda peça.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
