import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Carregando } from "@/components/bex/Carregando";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAMINHO_DO_MCP, comandoClaudeCode, FERRAMENTAS } from "@/domain/api/mcp";
import {
  CABECALHO_DO_TOKEN,
  CAMINHO_BASE,
  DIAS_DE_VALIDADE,
  exemploCurl,
  LIMITE_MAXIMO,
  RECURSOS,
  REQUISICOES_POR_MINUTO,
} from "@/domain/api/recursos";

/**
 * Ajustes › API e MCP (02/11/2026), Onda 1. O dono viu a tela do Holdprint e
 * pediu o mesmo caminho: um token pessoal, tratado como senha, para ler os
 * dados da gráfica de fora (Claude, planilha, outro programa).
 *
 * O token aparece UMA vez, na hora de gerar. Depois só o prefixo. Revogar é
 * imediato. A leitura sai pela API com a permissão de quem gerou o token: o
 * banco lê como a pessoa, e a RLS decide. O MCP é a próxima onda.
 */
export const Route = createFileRoute("/_authenticated/configuracoes-api")({
  head: () => ({ meta: [{ title: "API e MCP — BEX PRINT OS" }] }),
  component: ConfiguracoesApiPage,
});

type TokenDaLista = {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: string;
  expira_em: string;
  revogado_em: string | null;
  ultimo_uso_em: string | null;
  usos: number;
};

const data = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "nunca");

/** O que a linha da lista diz sobre o estado do token. */
export function estadoDoToken(t: Pick<TokenDaLista, "revogado_em" | "expira_em">, agora: Date = new Date()): "ativo" | "revogado" | "vencido" {
  if (t.revogado_em) return "revogado";
  return new Date(t.expira_em).getTime() <= agora.getTime() ? "vencido" : "ativo";
}

function ConfiguracoesApiPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const podeGerar = hasRole("admin") || hasRole("gestor");
  const [nome, setNome] = useState("");
  const [dias, setDias] = useState<number>(90);
  const [gerado, setGerado] = useState<{ token: string; prefixo: string; expira_em: string } | null>(null);
  const [revogando, setRevogando] = useState<string | null>(null);
  const base = typeof window === "undefined" ? "https://bexprint.com.br" : window.location.origin;

  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: linhas, error } = await (supabase as any)
        .from("api_tokens")
        .select("id, nome, prefixo, criado_em, expira_em, revogado_em, ultimo_uso_em, usos")
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (linhas ?? []) as TokenDaLista[];
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: r, error } = await (supabase.rpc as any)("criar_api_token", { p_nome: nome.trim(), p_dias: dias });
      if (error) throw error;
      return r as { token: string; prefixo: string; expira_em: string };
    },
    onSuccess: (r) => {
      setGerado(r);
      setNome("");
      toast.success("Token gerado. Copie agora: ele não aparece de novo.");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível gerar o token.")),
  });

  const revogar = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("revogar_api_token", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setRevogando(null);
      toast.success("Token revogado. Quem o usava perde o acesso agora.");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível revogar.")),
  });

  async function copiar(texto: string, aviso: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(aviso);
    } catch {
      toast.error("Não consegui copiar. Selecione o texto à mão.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Plug className="h-6 w-6 text-link" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">API e MCP</h1>
          <DicaIcone texto={dicaTela("/configuracoes-api")} rotulo="API e MCP" lado="bottom" className="h-5 w-5" />
        </div>
        <p className="text-muted-foreground">
          Conecte Claude, planilha ou outro programa aos dados da gráfica. Token pessoal, só leitura, com a sua permissão.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" aria-hidden="true" /> Seu token pessoal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!podeGerar ? (
            <p className="text-sm text-muted-foreground">Gerar token é de administrador e gerência. Peça a um deles.</p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!nome.trim()) return toast.error("Dê um nome ao token: onde ele vai ser usado.");
                gerar.mutate();
              }}
            >
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="token-nome">Onde vai ser usado</Label>
                <Input id="token-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Claude do Harison, planilha do financeiro…" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token-dias">Validade</Label>
                <select
                  id="token-dias"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={dias}
                  onChange={(e) => setDias(Number(e.target.value))}
                >
                  {DIAS_DE_VALIDADE.map((d) => (
                    <option key={d} value={d}>{d} dias</option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={gerar.isPending} data-testid="gerar-token">
                {gerar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />} Gerar token
              </Button>
            </form>
          )}

          {gerado && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3" data-testid="token-gerado">
              <p className="text-sm font-medium">Copie agora. Este token não aparece de novo.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-sm">{gerado.token}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => void copiar(gerado.token, "Token copiado.")}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Vale até {data(gerado.expira_em)}. Prefixo {gerado.prefixo} na lista abaixo.</p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-link" aria-hidden="true" />
            <p>
              <strong>Trate como senha.</strong> O token lê o que você lê no sistema. Não compartilhe; se vazar, revogue aqui e gere outro.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Seus tokens</h3>
            {tokens.isPending ? (
              <Carregando linhas={3} />
            ) : tokens.error ? (
              <p className="text-sm text-destructive">Não foi possível listar os tokens. Isto é falha de consulta, não lista vazia.</p>
            ) : (tokens.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum token ainda.</p>
            ) : (
              <ul className="divide-y rounded-md border" aria-label="Tokens da API">
                {(tokens.data ?? []).map((t) => {
                  const estado = estadoDoToken(t);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.nome}</span>
                        <span className="block text-xs text-muted-foreground">
                          <code className="font-mono">{t.prefixo}…</code> · criado em {data(t.criado_em)} · vale até {data(t.expira_em)} · último uso: {data(t.ultimo_uso_em)} · {t.usos} {t.usos === 1 ? "chamada" : "chamadas"}
                        </span>
                      </span>
                      <span className={estado === "ativo" ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900" : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"}>
                        {estado}
                      </span>
                      {estado === "ativo" && (
                        revogando === t.id ? (
                          <span className="flex items-center gap-2">
                            <Button type="button" size="sm" variant="destructive" onClick={() => revogar.mutate(t.id)} disabled={revogar.isPending}>
                              Confirmar revogação
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRevogando(null)}>Agora não</Button>
                          </span>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => setRevogando(t.id)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Revogar
                          </Button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como usar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Endereço base <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{base}{CAMINHO_BASE}</code>, token no cabeçalho{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{CABECALHO_DO_TOKEN}</code>. Até {REQUISICOES_POR_MINUTO} chamadas por minuto e {LIMITE_MAXIMO} linhas por página.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{exemploCurl(base)}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => void copiar(exemploCurl(base), "Exemplo copiado.")}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Recurso</th>
                  <th className="py-2 pr-3">O que vem</th>
                  <th className="py-2">Filtros</th>
                </tr>
              </thead>
              <tbody>
                {RECURSOS.map((r) => (
                  <tr key={r.chave} className="border-b align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{CAMINHO_BASE}/{r.chave}</td>
                    <td className="py-2 pr-3">
                      <span className="block font-medium">{r.titulo}</span>
                      <span className="block text-xs text-muted-foreground">{r.descricao}</span>
                    </td>
                    <td className="py-2 font-mono text-xs">{r.filtros.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            As datas em "desde" e "ate" são AAAA-MM-DD. A resposta traz total, limite, deslocamento e itens. Quem lê é a pessoa dona do token: nada além do que ela já vê no sistema.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conectar MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Endereço MCP <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{base}{CAMINHO_DO_MCP}</code>, com o mesmo token desta página no cabeçalho{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">Authorization: Bearer</code>. Seis ferramentas, só leitura:{" "}
            {FERRAMENTAS.map((f) => f.name).join(", ")}.
          </p>
          <div className="space-y-1.5">
            <p className="font-medium">Claude Code</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs" data-testid="comando-mcp">{comandoClaudeCode(base)}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copiar(comandoClaudeCode(base), "Comando copiado. Troque SEU_TOKEN pelo token gerado aqui.")}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Cursor, ChatGPT e outros: servidor MCP remoto do tipo http no endereço acima, com o cabeçalho Authorization: Bearer SEU_TOKEN. Depois peça: "use as ferramentas bexprint para listar meus orçamentos enviados". Quem lê é a pessoa dona do token.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
