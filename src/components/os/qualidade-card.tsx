import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Camera, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

type Inspecao = {
  id: string;
  data: string;
  resultado: string;
  observacao: string | null;
  respostas: { item: string; ok: boolean }[] | null;
  fotos: string[] | null;
  responsavel_id: string | null;
};

type Situacao = {
  exige: boolean;
  veredito: string | null;
  aprovada: boolean;
  reprovada: boolean;
  total_inspecoes: number;
};

const RESULTADOS = [
  { valor: "aprovado", rotulo: "Aprovado", icone: CheckCircle2, tom: "default" as const },
  { valor: "aprovado_com_ressalva", rotulo: "Aprovado com ressalva", icone: AlertTriangle, tom: "outline" as const },
  { valor: "retrabalho", rotulo: "Refazer", icone: XCircle, tom: "destructive" as const },
  { valor: "reprovado", rotulo: "Reprovado", icone: XCircle, tom: "destructive" as const },
];

const rotuloResultado: Record<string, string> = Object.fromEntries(
  RESULTADOS.map((r) => [r.valor, r.rotulo]),
);

/**
 * Inspeção de qualidade da OS.
 *
 * `fechar_os` exige inspeção aprovada quando a OS tem item com `requer_qualidade`
 * — e essa coluna nasce true, então toda OS real precisa passar por aqui. Nada
 * criava inspeção; era o guarda mais caro da lista, porque trava o fechamento.
 *
 * Reprovar devolve a OS para retrabalho no mesmo passo: sem isso a peça
 * reprovada seguiria para a entrega enquanto alguém lembra de mudar o status.
 */
export function QualidadeDaOS({ osId }: { osId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeInspecionar = hasPermission("qualidade.manage");

  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [observacao, setObservacao] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const { data: situacao } = useQuery({
    queryKey: ["situacao-qualidade", osId],
    queryFn: async (): Promise<Situacao | null> => {
      const { data, error } = await (supabase.rpc as any)("situacao_qualidade_os", {
        p_os_id: osId,
      });
      if (error) throw error;
      return data as Situacao;
    },
  });

  const { data: checklist } = useQuery({
    queryKey: ["checklist-qualidade"],
    enabled: podeInspecionar,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("qualidade_checklists")
        .select("id, operacao, itens")
        .eq("ativo", true)
        .limit(1);
      return data?.[0] ?? null;
    },
  });

  const { data: inspecoes = [] } = useQuery({
    queryKey: ["inspecoes", osId],
    queryFn: async (): Promise<Inspecao[]> => {
      const { data, error } = await (supabase as any)
        .from("qualidade_inspecoes")
        .select("id, data, resultado, observacao, respostas, fotos, responsavel_id")
        .eq("os_id", osId)
        .order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Inspecao[];
    },
  });

  async function enviarFoto(arquivo: File) {
    setEnviandoFoto(true);
    try {
      const ext = arquivo.name.split(".").pop() ?? "jpg";
      const caminho = `qualidade/${osId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("arquivos-clientes")
        .upload(caminho, arquivo, { contentType: arquivo.type });
      if (error) throw error;
      setFotos((f) => [...f, caminho]);
      toast.success("Foto anexada");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar a foto");
    } finally {
      setEnviandoFoto(false);
    }
  }

  const registrar = useMutation({
    mutationFn: async (resultado: string) => {
      const itens: string[] = checklist?.itens ?? [];
      const respostas = itens.map((item) => ({ item, ok: !!marcados[item] }));
      const { error } = await (supabase.rpc as any)("registrar_inspecao", {
        p_os_id: osId,
        p_resultado: resultado,
        p_respostas: respostas,
        p_fotos: fotos,
        p_observacao: observacao || null,
        p_checklist_id: checklist?.id ?? null,
      });
      if (error) throw error;
      return resultado;
    },
    onSuccess: (resultado) => {
      setMarcados({});
      setObservacao("");
      setFotos([]);
      toast.success(
        resultado === "aprovado" || resultado === "aprovado_com_ressalva"
          ? "Inspeção aprovada"
          : "Inspeção registrada — a OS voltou para retrabalho",
      );
      qc.invalidateQueries({ queryKey: ["inspecoes", osId] });
      qc.invalidateQueries({ queryKey: ["situacao-qualidade", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao registrar"),
  });

  const itens: string[] = checklist?.itens ?? [];
  const todosMarcados = itens.length > 0 && itens.every((i) => marcados[i]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Qualidade
          </CardTitle>
          {situacao?.exige && !situacao.aprovada && (
            <Badge variant="destructive" className="font-normal">
              {situacao.reprovada
                ? "reprovada — segura o fechamento"
                : "sem inspeção — segura o fechamento"}
            </Badge>
          )}
          {situacao?.aprovada && (
            <Badge variant="secondary" className="font-normal">
              {rotuloResultado[situacao.veredito ?? ""] ?? "aprovada"}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {podeInspecionar && (
          <div className="space-y-3 rounded-md border p-3">
            {itens.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-xs">Confira antes de decidir</Label>
                {itens.map((item) => (
                  <label key={item} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={!!marcados[item]}
                      onCheckedChange={(v) =>
                        setMarcados((m) => ({ ...m, [item]: v === true }))
                      }
                    />
                    {item}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum checklist cadastrado — a inspeção fica só com a observação e a foto.
              </p>
            )}

            <div>
              <Label htmlFor="insp-obs" className="text-xs">
                Observação {"(obrigatória para reprovar)"}
              </Label>
              <Textarea
                id="insp-obs"
                rows={2}
                placeholder="Ex.: o vermelho saiu alaranjado nas 200 primeiras peças"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                className="max-w-[220px]"
                disabled={enviandoFoto}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void enviarFoto(f);
                  e.target.value = "";
                }}
              />
              {enviandoFoto && <span className="text-sm text-muted-foreground">enviando…</span>}
              {fotos.map((f) => (
                <Badge key={f} variant="secondary" className="gap-1 font-normal">
                  <Camera className="h-3 w-3" /> {f.split("/").pop()}
                </Badge>
              ))}
            </div>

            {itens.length > 0 && !todosMarcados && (
              <p className="text-xs text-amber-600">
                Nem todos os itens estão marcados — aprovar assim registra as respostas como
                estão.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {RESULTADOS.map((r) => (
                <Button
                  key={r.valor}
                  variant={r.tom === "default" ? "default" : "outline"}
                  size="sm"
                  disabled={registrar.isPending}
                  className={r.tom === "destructive" ? "text-destructive" : undefined}
                  onClick={() => registrar.mutate(r.valor)}
                >
                  <r.icone className="h-4 w-4 mr-1" /> {r.rotulo}
                </Button>
              ))}
            </div>
          </div>
        )}

        {inspecoes.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhuma inspeção registrada.{" "}
            {situacao?.exige
              ? "Esta OS tem item que exige conferência — sem ela o fechamento fica travado."
              : ""}
          </div>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {inspecoes.map((i) => {
              const ok = i.resultado === "aprovado" || i.resultado === "aprovado_com_ressalva";
              const naoConformes = (i.respostas ?? []).filter((r) => !r.ok);
              return (
                <div key={i.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant={ok ? "secondary" : "destructive"} className="font-normal">
                      {rotuloResultado[i.resultado] ?? i.resultado}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(i.data).toLocaleString("pt-BR")}
                    </span>
                    {(i.fotos?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Camera className="h-3 w-3" /> {i.fotos!.length}
                      </span>
                    )}
                  </div>
                  {i.observacao && <div className="text-muted-foreground">{i.observacao}</div>}
                  {naoConformes.length > 0 && (
                    <div className="text-xs text-amber-600">
                      Não conformes: {naoConformes.map((r) => r.item).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
