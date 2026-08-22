import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs & Auditoria — BEX PRINT OS" }] }),
  component: LogsPage,
});

type Log = {
  id: string;
  created_at: string;
  usuario_id: string | null;
  entidade: string;
  entidade_id: string | null;
  acao: string;
  detalhes: { antes?: Record<string, unknown>; depois?: Record<string, unknown> } | null;
};

/** Só o que é auditado hoje — filtro que oferece entidade sem registro engana. */
const entidades = [
  { valor: "", rotulo: "Tudo" },
  { valor: "user_roles", rotulo: "Papéis" },
  { valor: "portal_cliente_acessos", rotulo: "Acesso ao portal" },
  { valor: "pagamentos", rotulo: "Pagamentos" },
  { valor: "caixa_movimentos", rotulo: "Caixa" },
  { valor: "notificacao_templates", rotulo: "Mensagens automáticas" },
];

const rotuloAcao: Record<string, { texto: string; tom: "secondary" | "outline" | "destructive" }> = {
  insert: { texto: "criou", tom: "secondary" },
  update: { texto: "alterou", tom: "outline" },
  delete: { texto: "removeu", tom: "destructive" },
};

/**
 * Descreve a linha em uma frase, em vez de despejar o jsonb.
 *
 * O log guarda o registro inteiro antes e depois; quem audita quer saber o que
 * mudou, não ler duas cópias da linha.
 */
function resumir(log: Log): string {
  const antes = log.detalhes?.antes ?? {};
  const depois = log.detalhes?.depois ?? {};

  if (log.entidade === "user_roles") {
    const papel = String(depois.role ?? antes.role ?? "?");
    return log.acao === "delete" ? `papel ${papel} removido` : `papel ${papel} concedido`;
  }
  if (log.entidade === "portal_cliente_acessos") {
    if (log.acao === "insert") return "acesso ao portal liberado";
    if (log.acao === "delete") return "acesso ao portal removido";
    return depois.ativo ? "acesso reativado" : "acesso desativado";
  }

  if (log.acao === "update") {
    const mudou = Object.keys(depois).filter(
      (k) => k !== "updated_at" && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]),
    );
    return mudou.length > 0 ? `alterou ${mudou.join(", ")}` : "sem mudança de campo";
  }
  return log.acao === "delete" ? "registro removido" : "registro criado";
}

function LogsPage() {
  const [entidade, setEntidade] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["logs-auditoria", entidade],
    queryFn: async () => {
      let q = supabase
        .from("logs_auditoria")
        .select("id, created_at, usuario_id, entidade, entidade_id, acao, detalhes")
        .order("created_at", { ascending: false })
        .limit(200);
      if (entidade) q = q.eq("entidade", entidade);
      const { data: logs, error } = await q;
      if (error) throw error;

      const linhas = (logs ?? []) as unknown as Log[];
      const ids = [...new Set(linhas.map((l) => l.usuario_id).filter(Boolean))] as string[];
      const { data: usuarios } = ids.length
        ? await supabase.from("usuarios").select("id, nome").in("id", ids)
        : { data: [] as { id: string; nome: string }[] };
      const nomePorId = new Map((usuarios ?? []).map((u: any) => [u.id, u.nome]));
      return { linhas, nomePorId };
    },
  });

  const linhas = data?.linhas ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Logs &amp; Auditoria</h1>
        <p className="text-muted-foreground">
          Quem mexeu em papéis, acessos, dinheiro e nas mensagens que saem em nome da gráfica
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {entidades.map((e) => (
          <Button
            key={e.valor}
            size="sm"
            variant={entidade === e.valor ? "default" : "outline"}
            onClick={() => setEntidade(e.valor)}
          >
            {e.rotulo}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Últimas ações
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">Carregando…</div>
          ) : linhas.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              Nenhuma ação registrada ainda. O rastro começa a partir de agora: mudanças de
              papel, liberação de portal, pagamentos, caixa e edição das mensagens automáticas.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Onde</TableHead>
                  <TableHead>O que mudou</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => {
                  const acao = rotuloAcao[l.acao] ?? { texto: l.acao, tom: "outline" as const };
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {/* `usuarios` só é legível por admin/gestor; sem nome, o id
                            é melhor que um traço — dá para rastrear mesmo assim. */}
                        {data?.nomePorId.get(l.usuario_id ?? "") ??
                          (l.usuario_id ? (
                            <span className="font-mono text-xs">{l.usuario_id.slice(0, 8)}</span>
                          ) : (
                            <span className="text-muted-foreground">sistema</span>
                          ))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={acao.tom}>{acao.texto}</Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {entidades.find((e) => e.valor === l.entidade)?.rotulo ?? l.entidade}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{resumir(l)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
