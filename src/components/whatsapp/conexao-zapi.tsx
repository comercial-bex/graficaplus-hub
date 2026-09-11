import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Link2, Plug, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/bex/StatusChip";
import { gerarSegredo, hashDoSegredo, urlDoWebhook } from "@/domain/whatsapp/segredo-webhook";
import { origemServeParaWebhook, situacaoDaConexao } from "@/domain/whatsapp/situacao-conexao";

/**
 * Conexão com o WhatsApp (Z-API).
 *
 * Não existia caminho nenhum para conectar: nem tela, nem função. Mesmo com
 * conta aberta no Z-API, a instância não tinha onde ser cadastrada — e o
 * receptor não tinha URL para colar no painel deles.
 *
 * O segredo do webhook é sorteado AQUI, no navegador, aparece uma vez e só o
 * hash vai ao banco. Por isso a URL não pode ser mostrada de novo depois:
 * quem perdeu gera outra, e a antiga para de valer.
 */

type Instancia = {
  id: string;
  nome: string | null;
  zapi_instance_id: string;
  numero: string | null;
  status: string | null;
  conectado: boolean | null;
  ultimo_evento_at: string | null;
  ativa: boolean | null;
};

export function ConexaoZapi() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeGerenciar = hasPermission("whatsapp.manage");

  const { data: instancias = [], isLoading } = useQuery({
    queryKey: ["whatsapp-instancias"],
    queryFn: async () => {
      // Lista explícita de colunas: o hash do segredo não é legível pela
      // equipe, e select("*") pediria a coluna proibida e falharia inteiro.
      const { data, error } = await supabase
        .from("whatsapp_instancias")
        .select("id, nome, zapi_instance_id, numero, status, conectado, ultimo_evento_at, ativa")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Instancia[];
    },
  });

  const [zapiId, setZapiId] = useState("");
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [urlGerada, setUrlGerada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const origem = typeof window !== "undefined" ? window.location.origin : "";
  const origemValida = origemServeParaWebhook(origem);

  async function gerarEndereco(dados: { zapiInstanceId: string; nome?: string; numero?: string }) {
    if (!origemValida) {
      toast.error("Abra o sistema pelo endereço publicado para gerar a URL do webhook.");
      return;
    }
    setSalvando(true);
    try {
      const segredo = gerarSegredo();
      const hash = await hashDoSegredo(segredo);
      const { error } = await (supabase.rpc as any)("whatsapp_configurar_instancia", {
        p_zapi_instance_id: dados.zapiInstanceId,
        p_nome: dados.nome ?? null,
        p_numero: dados.numero ?? null,
        p_webhook_secret_hash: hash,
      });
      if (error) throw error;
      setUrlGerada(urlDoWebhook(origem, segredo));
      setCopiado(false);
      setZapiId("");
      setNome("");
      setNumero("");
      qc.invalidateQueries({ queryKey: ["whatsapp-instancias"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function copiar() {
    if (!urlGerada) return;
    try {
      await navigator.clipboard.writeText(urlGerada);
      setCopiado(true);
    } catch {
      toast.error("Não foi possível copiar. Selecione o endereço e copie à mão.");
    }
  }

  const instancia = instancias[0] ?? null;
  const situacao = situacaoDaConexao(instancia);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" /> Conexão com o WhatsApp
        </CardTitle>
        {!isLoading && <StatusChip label={situacao.rotulo} tone={situacao.tom} />}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {instancias.map((i) => (
          <div key={i.id} className="rounded border border-border/60 bg-muted/30 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-foreground">{i.nome ?? "WhatsApp da empresa"}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                instância {i.zapi_instance_id}
                {i.numero ? ` · ${i.numero}` : ""}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Último evento recebido:{" "}
              {i.ultimo_evento_at
                ? new Date(i.ultimo_evento_at).toLocaleString("pt-BR")
                : "nenhum até agora"}
            </div>
            {podeGerenciar && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={salvando}
                onClick={() => {
                  if (
                    window.confirm(
                      "Gerar um novo endereço faz o atual parar de funcionar. Você vai precisar colar o novo no painel do Z-API. Continuar?",
                    )
                  ) {
                    gerarEndereco({ zapiInstanceId: i.zapi_instance_id });
                  }
                }}
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" /> Gerar novo endereço do webhook
              </Button>
            )}
          </div>
        ))}

        {situacao.proximoPasso && (
          <p className="text-xs text-muted-foreground">{situacao.proximoPasso}</p>
        )}

        {urlGerada && (
          <div className="space-y-2 rounded border border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5 p-3">
            <div className="text-xs font-semibold text-foreground">
              Endereço do webhook — copie agora, ele não aparece de novo
            </div>
            <div className="flex gap-2">
              <Input readOnly value={urlGerada} className="h-8 font-mono text-[11px]" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={copiar}>
                {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              <li>No painel do Z-API, abra a instância e vá em Webhooks.</li>
              <li>
                Cole este endereço em <strong>Ao receber</strong>, <strong>Status da mensagem</strong>,{" "}
                <strong>Ao conectar</strong> e <strong>Ao desconectar</strong>.
              </li>
              <li>Mande uma mensagem de teste para o número da empresa. O status aqui muda para “Recebendo”.</li>
            </ol>
          </div>
        )}

        {podeGerenciar && instancias.length === 0 && (
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              gerarEndereco({ zapiInstanceId: zapiId, nome, numero });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="zapi-id">ID da instância no Z-API</Label>
              <Input
                id="zapi-id"
                required
                value={zapiId}
                onChange={(e) => setZapiId(e.target.value)}
                placeholder="como aparece no painel deles"
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="zapi-nome">Nome</Label>
              <Input id="zapi-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="WhatsApp da empresa" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="zapi-numero">Número</Label>
              <Input id="zapi-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(96) 9 0000-0000" />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" size="sm" disabled={salvando || !zapiId.trim()}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" /> Cadastrar e gerar o endereço do webhook
              </Button>
            </div>
          </form>
        )}

        {!origemValida && podeGerenciar && (
          <p className="flex items-start gap-1.5 text-[11px] text-[color:var(--bex-amber)]">
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
            Este é um endereço de pré-visualização. A URL do webhook precisa ser gerada a partir do
            endereço publicado do sistema.
          </p>
        )}

        {!podeGerenciar && instancias.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Peça a quem administra o sistema para conectar o WhatsApp (permissão whatsapp › manage).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
