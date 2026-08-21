import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bell } from "lucide-react";
import { toast } from "sonner";

type Template = {
  evento: string;
  descricao: string;
  corpo: string;
  ativo: boolean;
};

/** Variáveis que cada gatilho grava — mostrar evita template com chave inventada. */
const variaveisPorEvento: Record<string, string[]> = {
  orcamento_aprovado: ["cliente", "orcamento_numero", "valor_total"],
  os_arte_para_aprovar: ["cliente", "os_numero", "os_titulo", "prazo"],
  os_em_producao: ["cliente", "os_numero", "os_titulo", "prazo"],
  os_pronta_retirada: ["cliente", "os_numero", "os_titulo", "prazo"],
  os_saiu_entrega: ["cliente", "os_numero", "os_titulo", "prazo"],
  os_concluida: ["cliente", "os_numero", "os_titulo", "prazo"],
};

/**
 * Texto das mensagens que saem sozinhas quando a OS muda de etapa.
 *
 * O gatilho grava só o NOME do evento na fila; o texto mora aqui para poder ser
 * mudado sem redeploy da edge function. Evento sem template ativo não é enviado.
 */
export function TemplatesAutomaticosCard() {
  const qc = useQueryClient();
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["notificacao-templates"],
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await (supabase as any)
        .from("notificacao_templates")
        .select("evento, descricao, corpo, ativo")
        .order("evento");
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const salvar = useMutation({
    mutationFn: async ({ evento, mudanca }: { evento: string; mudanca: Partial<Template> }) => {
      // Escrita barrada por RLS devolve 0 linhas e nenhum erro — sem conferir o
      // retorno, a tela diria "salvo" com o texto antigo ainda no ar.
      const { data, error } = await (supabase as any)
        .from("notificacao_templates")
        .update(mudanca)
        .eq("evento", evento)
        .select("evento");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para editar as mensagens automáticas.");
      }
    },
    onSuccess: (_r, { evento }) => {
      setRascunhos((r) => {
        const { [evento]: _, ...resto } = r;
        return resto;
      });
      toast.success("Mensagem atualizada");
      qc.invalidateQueries({ queryKey: ["notificacao-templates"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Avisos automáticos ao cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Estas mensagens saem sozinhas no WhatsApp quando o orçamento é aprovado e a cada
          mudança de etapa da OS. Desligar um aviso interrompe o envio daquele evento sem
          apagar o texto.
        </p>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          templates.map((t) => {
            const rascunho = rascunhos[t.evento];
            const alterado = rascunho !== undefined && rascunho !== t.corpo;
            return (
              <div key={t.evento} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{t.descricao}</div>
                    <code className="text-[11px] text-muted-foreground">{t.evento}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t.ativo ? "enviando" : "desligado"}
                    </span>
                    <Switch
                      checked={t.ativo}
                      aria-label={`Ligar ou desligar o aviso ${t.descricao}`}
                      onCheckedChange={(v) =>
                        salvar.mutate({ evento: t.evento, mudanca: { ativo: v } })
                      }
                    />
                  </div>
                </div>

                <Textarea
                  rows={3}
                  className="font-mono text-sm"
                  value={rascunho ?? t.corpo}
                  onChange={(e) =>
                    setRascunhos((r) => ({ ...r, [t.evento]: e.target.value }))
                  }
                />

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">Variáveis:</span>
                    {(variaveisPorEvento[t.evento] ?? []).map((v) => (
                      <Badge
                        key={v}
                        variant="outline"
                        className="font-mono text-[10px] font-normal cursor-pointer"
                        onClick={() =>
                          setRascunhos((r) => ({
                            ...r,
                            [t.evento]: `${r[t.evento] ?? t.corpo}{{${v}}}`,
                          }))
                        }
                      >
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                  {alterado && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRascunhos((r) => {
                            const { [t.evento]: _, ...resto } = r;
                            return resto;
                          })
                        }
                      >
                        Descartar
                      </Button>
                      <Button
                        size="sm"
                        disabled={salvar.isPending}
                        onClick={() =>
                          salvar.mutate({ evento: t.evento, mudanca: { corpo: rascunho } })
                        }
                      >
                        Salvar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
