import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import { ArrowLeft, FileDown } from "lucide-react";
import { toast } from "sonner";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";

export const Route = createFileRoute("/_authenticated/orcamento-3d/$id")({
  head: () => ({ meta: [{ title: "Orçamento 3D — BEX PRINT OS" }] }),
  component: OrcamentoDetalhe,
});

const money = (v: any) => `R$ ${Number(v ?? 0).toFixed(2)}`;

function OrcamentoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const { data: orc, isLoading } = useQuery({
    queryKey: ["orcamento-3d", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("orcamentos_3d")
        .select("*, clientes(nome)")
        .eq("id", id)
        .maybeSingle();
      return data;
    },
  });

  const { data: calc } = useQuery({
    queryKey: ["orcamento-3d-calc", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("orcamento_3d_calculos")
        .select("*")
        .eq("orcamento_3d_id", id)
        .order("versao", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

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
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground">Carregando...</div>;
  if (!orc) return <div className="text-muted-foreground">Orçamento não encontrado</div>;

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
          <h1 className="text-2xl font-bold tracking-tight">{orc.titulo}</h1>
          <p className="text-muted-foreground">
            {orc.clientes?.nome ?? "Sem cliente"} · Qtd {Number(orc.quantidade ?? 1)}
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhamento de custo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {linhas.map(([label, v]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{money(v)}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex items-center justify-between text-sm font-semibold">
                <span>Custo operacional</span>
                <span className="font-mono">{money(calc?.custo_operacional)}</span>
              </div>
              <div className="rounded-lg bg-primary/10 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    Preço {calc?.markup ? `(${Number(calc.markup)}×)` : ""}
                  </span>
                  <span className="font-mono text-lg font-bold">{money(orc.preco_comercial)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Margem líquida</span>
                  <span className="font-mono">{((Number(calc?.margem ?? 0)) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Lucro</span>
                  <span className="font-mono">{money(calc?.lucro)}</span>
                </div>
                {Number(orc.quantidade ?? 1) > 1 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Unitário</span>
                    <span className="font-mono">{money(calc?.valor_unitario)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

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
        </div>

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
                <p className="text-sm text-muted-foreground">Sem print anexado</p>
              )}
            </CardContent>
          </Card>
        </div>
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
