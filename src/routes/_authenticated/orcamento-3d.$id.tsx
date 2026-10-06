import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import { AlertTriangle, ArrowLeft, FileDown, Lock } from "lucide-react";
import { toast } from "sonner";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/orcamento-3d/$id")({
  head: () => ({ meta: [{ title: "Orçamento 3D — BEX PRINT OS" }] }),
  component: OrcamentoDetalhe,
});

const money = (v: any) => `R$ ${Number(v ?? 0).toFixed(2)}`;

/**
 * Quem não pode ver custo não vê custo — e não vê zero no lugar dele.
 *
 * O cálculo (orcamento_3d_calculos) é dado de custo: a leitura exige
 * `impressao3d.cost.read` (admin, gestor, financeiro). Operador e vendedor
 * abrem esta tela com `impressao3d.read`, e a consulta deles caía no banco; a
 * tela jogava o erro fora e mostrava material, máquina, energia, custo
 * operacional, lucro = R$ 0.00 e margem 0,0% ao lado do preço real — um
 * número inventado com cara de cálculo. Agora a consulta só sai para quem
 * pode, e o lugar do custo diz por que está vazio.
 */
const AVISO_SEM_PERMISSAO_DE_CUSTO =
  "Custo, margem, lucro, os parâmetros do cálculo e o print do fatiador ficam visíveis só para quem tem permissão de ver custo (impressao3d.cost.read).";

function OrcamentoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const podeVerCusto = hasPermission("impressao3d.cost.read");
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const {
    data: orc,
    isLoading,
    isError: orcamentoComErro,
    error: erroDoOrcamento,
    isFetching: buscandoOrcamento,
    refetch: tentarOrcamentoDeNovo,
  } = useQuery({
    queryKey: ["orcamento-3d", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamentos_3d")
        .select("*, clientes(nome)")
        .eq("id", id)
        .maybeSingle();
      // Consulta caída não é "orçamento não encontrado".
      if (error) throw error;
      return data;
    },
  });

  const calculo = useQuery({
    queryKey: ["orcamento-3d-calc", id],
    enabled: podeVerCusto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamento_3d_calculos")
        .select("*")
        .eq("orcamento_3d_id", id)
        .order("versao", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Para quem pode ver custo, falha de consulta aparece como falha —
      // nunca como R$ 0,00.
      if (error) throw error;
      return data;
    },
  });
  const calc = podeVerCusto ? calculo.data : null;

  const inputs = (calc?.inputs_json ?? {}) as any;

  useEffect(() => {
    const path = inputs?.slicer_screenshot;
    if (!path) {
      setShotUrl(null);
      return;
    }
    let active = true;
    supabase.storage
      .from("arquivos-clientes")
      .createSignedUrl(path, 300)
      .then(({ data }) => {
        if (active) setShotUrl(data?.signedUrl ?? null);
      });
    return () => {
      active = false;
    };
  }, [inputs?.slicer_screenshot]);

  const converter = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("converter_orcamento_3d_em_os", {
        p_orcamento_3d_id: id,
      });
      if (error) throw error;
      return data as { os_id: string };
    },
    onSuccess: (res) => {
      toast.success("Orçamento convertido em OS");
      qc.invalidateQueries({ queryKey: ["orcamento-3d", id] });
      if (res?.os_id) navigate({ to: "/os/$id", params: { id: res.os_id } });
    },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <div className="text-muted-foreground">Carregando...</div>;
  if (orcamentoComErro) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Não foi possível carregar o orçamento 3D</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{mensagemErro(erroDoOrcamento)}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={buscandoOrcamento}
            onClick={() => void tentarOrcamentoDeNovo()}
          >
            {buscandoOrcamento ? "Tentando..." : "Tentar de novo"}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!orc) return <div className="text-muted-foreground">Orçamento não encontrado</div>;

  const quantidade = Number(orc.quantidade ?? 1) || 1;
  // Preço e quantidade vêm do próprio orçamento, que todo mundo desta tela lê.
  // O unitário é a divisão dos dois — não o `valor_unitario` do cálculo, que é
  // tabela de custo.
  const blocoDePreco = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Preço {calc?.markup ? `(${Number(calc.markup)}×)` : ""}
        </span>
        <span className="font-mono text-lg font-bold">{money(orc.preco_comercial)}</span>
      </div>
      {quantidade > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Unitário</span>
          <span className="font-mono">{money(Number(orc.preco_comercial ?? 0) / quantidade)}</span>
        </div>
      )}
    </>
  );

  const linhas: Array<[string, any]> = [
    ["Material", calc?.custo_material],
    ["Máquina", calc?.custo_maquina],
    ["Energia", calc?.custo_energia],
    ["Mão de obra", calc?.custo_mao_obra],
    ["Acabamento", calc?.custo_acabamento],
    ["Falha", calc?.custo_risco],
    ["Adm./embalagem", calc?.custo_indireto],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/impressao-3d">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{orc.titulo}</h1>
            <DicaIcone texto={dicaTela("/orcamento-3d")} rotulo="Orçamento 3D" lado="bottom" className="h-5 w-5" />
          </div>
          <p className="text-muted-foreground">
            {orc.clientes?.nome ?? orc.contato_nome ?? "Sem cliente"} · Qtd {Number(orc.quantidade ?? 1)}
          </p>
        </div>
        <StatusChip label={orc.status} tone={orc.status === "convertido" ? "lime" : "muted"} />
        <Button variant="outline" onClick={() => setPdfOpen(true)}>
          <FileDown className="h-4 w-4 mr-1" /> Gerar PDF
        </Button>
        {orc.os_id ? (
          <Button asChild variant="outline">
            <Link to="/os/$id" params={{ id: orc.os_id }}>
              Ver OS
            </Link>
          </Button>
        ) : (
          <Button
            disabled={!orc.cliente_id || converter.isPending}
            title={!orc.cliente_id ? "Associe um cliente antes de converter" : "Converter em OS"}
            onClick={() => converter.mutate()}
          >
            Converter em OS
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {!podeVerCusto ? (
            // Sem a permissão, nenhum número de custo é pedido nem desenhado:
            // só o preço, que é do orçamento, e a razão de o resto não estar ali.
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preço</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg bg-primary/10 p-3 space-y-1">{blocoDePreco}</div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {AVISO_SEM_PERMISSAO_DE_CUSTO}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detalhamento de custo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {calculo.isError ? (
                  <div role="alert" className="space-y-2 text-sm">
                    <p className="font-medium">Não foi possível carregar o cálculo de custo.</p>
                    <p className="text-muted-foreground">{mensagemErro(calculo.error)}</p>
                    <p className="text-muted-foreground">
                      Isto é uma falha de consulta: o custo deste orçamento não é zero.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={calculo.isFetching}
                      onClick={() => void calculo.refetch()}
                    >
                      {calculo.isFetching ? "Tentando..." : "Tentar de novo"}
                    </Button>
                  </div>
                ) : calculo.isPending ? (
                  <p className="text-sm text-muted-foreground">Carregando o cálculo de custo...</p>
                ) : !calc ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Este orçamento não tem cálculo de custo gravado.
                    </p>
                    <div className="rounded-lg bg-primary/10 p-3 space-y-1">{blocoDePreco}</div>
                  </>
                ) : (
                  <>
                    {linhas.map(([label, v]) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono">{money(v)}</span>
                      </div>
                    ))}
                    <div className="border-t pt-2 flex items-center justify-between text-sm font-semibold">
                      <span>Custo operacional</span>
                      <span className="font-mono">{money(calc.custo_operacional)}</span>
                    </div>
                    <div className="rounded-lg bg-primary/10 p-3 space-y-1">
                      {blocoDePreco}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Margem líquida</span>
                        <span className="font-mono">{(Number(calc.margem ?? 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Lucro</span>
                        <span className="font-mono">{money(calc.lucro)}</span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {calc && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Parâmetros do orçamento</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Param label="Impressora" value={inputs.impressora} />
                <Param label="Filamento" value={inputs.filamento} />
                <Param label="Gramas" value={inputs.gramas != null ? `${inputs.gramas} g` : null} />
                <Param
                  label="Tempo"
                  value={inputs.horas_totais != null ? `${Number(inputs.horas_totais).toFixed(2)} h` : null}
                />
                <Param
                  label="Custo-hora máquina"
                  value={inputs.custo_hora_maquina != null ? `${money(inputs.custo_hora_maquina)}/h` : null}
                />
                <Param label="Tarifa energia" value={inputs.tarifa_kwh != null ? money(inputs.tarifa_kwh) : null} />
                <Param label="% Acabamento" value={inputs.pct_acabamento != null ? `${inputs.pct_acabamento}%` : null} />
                <Param label="% Falha" value={inputs.pct_falha != null ? `${inputs.pct_falha}%` : null} />
                <Param label="Adm./embalagem" value={inputs.custo_admin != null ? money(inputs.custo_admin) : null} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* O print do fatiador é guardado junto do cálculo de custo
            (inputs_json): sem a permissão não há como saber se existe, então
            o cartão some em vez de dizer "sem print anexado". */}
        {podeVerCusto && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Print do fatiador</CardTitle>
              </CardHeader>
              <CardContent>
                {shotUrl ? (
                  <a href={shotUrl} target="_blank" rel="noreferrer">
                    <img src={shotUrl} alt="Print do fatiador" className="rounded-lg border max-w-full" />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {calc ? "Sem print anexado" : "—"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <PDFPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        tipo="orcamento_3d"
        referencia_id={id}
      />
    </div>
  );
}

function Param({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}
