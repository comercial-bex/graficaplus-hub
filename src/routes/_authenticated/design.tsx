import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/module-data";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { osEstaEncerrada } from "@/domain/os/etapas";
import { CartaoDaArte, type ArteDaFila } from "@/components/design/cartao-da-arte";
import { situacaoDaArte } from "@/components/design/tipo-de-arquivo";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/design")({
  head: () => ({ meta: [{ title: "Design & Arte — BEX PRINT OS" }] }),
  component: DesignPage,
});

/**
 * A fila do design: artes que ainda não são o arquivo final de produção.
 *
 * Três defeitos que esta tela tinha, e o que entrou no lugar:
 *   - o cartão mostrava um ícone fixo no lugar da arte: aprovava-se sem ver a
 *     peça. Agora é a miniatura real (URL assinada curta) ou, para PDF/AI, o
 *     tipo, o nome e "Abrir" — e "Aprovar" só libera depois de ver;
 *   - o botão com o balão de comentário CONCLUÍA a arte. Agora ele comenta
 *     (arquivo_comentarios) e concluir fica no botão que diz "Concluir";
 *   - a aprovação gravava direto em `aprovacoes`, sem o histórico da peça e
 *     sem mexer na OS. Agora passa por registrar_aprovacao_interna, a mesma
 *     função da ficha da OS.
 * E a fila listava arquivo inativo e removido ("[teste removido]"): agora só
 * ativo, não substituído, do tipo arte ou outro (é como a ficha da OS grava).
 */
function DesignPage() {
  const { hasPermission } = useAuth();
  // Cada ação segue a régua da função ou da policy que ela chama.
  const pode = {
    decidir: hasPermission("os.update"),
    pedirAoCliente: hasPermission("arquivos.request_approval"),
    concluir: hasPermission("arquivos.finalize"),
    verOrcamento: hasPermission("orcamentos.read"),
  };

  // Quem já VIU a peça nesta sessão: a miniatura carregou ou abriu o arquivo.
  const [vistas, setVistas] = useState<Set<string>>(() => new Set());
  const marcarVista = useCallback((id: string) => {
    setVistas((atual) => (atual.has(id) ? atual : new Set(atual).add(id)));
  }, []);

  const fila = useQuery({
    queryKey: ["design-fila"],
    queryFn: async () => {
      const { data, error } = await db
        .from("arquivos")
        .select(
          "id, os_id, cliente_id, nome, caminho, bucket, mime_type, mime, tamanho_bytes, tamanho, versao, status, tipo, created_at, " +
            "ordens_servico(numero, titulo, status, cliente_id, designer_id, clientes(nome, telefone), usuarios!ordens_servico_designer_id_fkey(nome)), " +
            "clientes(nome), arquivo_aprovacoes(decisao, comentario, canal, created_at), arquivo_comentarios(count)",
        )
        .eq("ativo", true)
        .eq("final_producao", false)
        // A ficha da OS grava todo upload como 'outro' (o tipo escolhido na tela
        // não vai para o insert): filtrar só 'arte' esconderia a arte de OS.
        .in("tipo", ["arte", "outro"])
        .not("status", "in", "(substituido,inativo)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ArteDaFila[];
    },
  });

  const { deOs, deOrcamento, contagem } = useMemo(() => {
    const artes = fila.data ?? [];
    const deOs = artes
      .filter((a) => a.os_id && !osEstaEncerrada(a.ordens_servico?.status))
      .sort(
        (a, b) =>
          situacaoDaArte(a.status).ordem - situacaoDaArte(b.status).ordem ||
          b.created_at.localeCompare(a.created_at),
      );
    const deOrcamento = artes.filter((a) => !a.os_id);
    const contagem = { ajuste: 0, aguardando: 0, aprovada: 0 };
    for (const a of deOs) contagem[situacaoDaArte(a.status).chave] += 1;
    return { deOs, deOrcamento, contagem };
  }, [fila.data]);

  // Imagem com miniatura conta como vista quando carrega (onLoad); PDF, AI e o
  // resto, quando a pessoa clica em "Abrir".
  const foiVista = (a: ArteDaFila) => vistas.has(a.id);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Design & Aprovação de Arte</h1>
          <DicaIcone
            texto={dicaTela("/design")}
            rotulo="Design e Aprovação de Arte"
            lado="bottom"
            className="h-5 w-5"
          />
        </div>
        <p className="text-muted-foreground">
          Fila de artes aguardando aprovação interna ou do cliente
        </p>
      </div>

      {fila.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar a fila de artes</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{mensagemErro(fila.error)}</p>
            <p>Isto é uma falha de consulta, não uma fila vazia.</p>
            <Button variant="outline" size="sm" onClick={() => void fila.refetch()}>
              Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      ) : fila.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando a fila…</p>
      ) : (
        <>
          {deOs.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {contagem.ajuste} com ajuste pedido · {contagem.aguardando} aguardando aprovação ·{" "}
              {contagem.aprovada} aprovadas, falta concluir
            </p>
          )}

          {deOs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Nenhuma arte de OS esperando aprovação ou conclusão.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {deOs.map((a) => (
                <CartaoDaArte
                  key={a.id}
                  arte={a}
                  pode={pode}
                  vista={foiVista(a)}
                  onVista={marcarVista}
                />
              ))}
            </div>
          )}

          {deOrcamento.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">
                  Artes de orçamentos que ainda não viraram OS
                </h2>
                <p className="text-sm text-muted-foreground">
                  Dá para ver e comentar. Aprovar e concluir ficam para quando o orçamento for
                  convertido em OS — a aprovação de arte é registrada na OS.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {deOrcamento.map((a) => (
                  <CartaoDaArte
                    key={a.id}
                    arte={a}
                    pode={pode}
                    vista={foiVista(a)}
                    onVista={marcarVista}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
