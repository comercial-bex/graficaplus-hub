/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ClipboardList,
  DollarSign,
  Hourglass,
  Loader2,
  PackageCheck,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { ArteParaAprovarCartao } from "@/components/portal/arte-para-aprovar";
import {
  ContatoDaEmpresa,
  EnvioDeArquivo,
  MensagemParaEquipe,
  OQueVoceMandou,
  OrcamentosParaResponder,
  type Recibo,
} from "@/components/portal/envio-do-cliente";
import { type ObterUrl } from "@/components/portal/abrir-arquivo";
import { ListaDePedidos } from "@/components/portal/pedidos-do-cliente";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { bucketDoEnvio, caminhoDoEnvio, type TipoDeEnvio } from "@/domain/portal/envio-de-arquivo";
import {
  formatarReal,
  resumoDoPortal,
  type PainelDaConta,
} from "@/domain/portal/painel-do-cliente";

/**
 * Portal do cliente LOGADO (papel cliente, vinculado na ficha do cliente).
 *
 * O QUE ESTAVA ERRADO
 *   - A lista de OS lia `ordens_servico_financeiro`, que só devolve linha para
 *     quem tem financeiro.read: a conta de cliente (só portal.read) via sempre
 *     "Nenhuma OS registrada", com OS abertas no nome dele.
 *   - O "Resumo do fechamento" mostrava a RECEITA LÍQUIDA da OS — número interno
 *     de resultado — ao cliente.
 *   - O envio de arquivo estava desligado ("Upload direto virá em breve").
 *
 * AGORA
 *   Tudo vem de `portal_meu_painel`, que só enxerga os clientes vinculados à
 *   conta em `portal_cliente_acessos` e devolve lista fechada: número, título,
 *   situação, prazo e o VALOR DO PEDIDO (o preço do que ele comprou). Custo,
 *   margem e resultado não existem na resposta. O arquivo sobe para a pasta do
 *   cliente no bucket arquivos-clientes (a policy de storage.objects confere a
 *   pasta) e `portal_registrar_envio` grava a linha em `arquivos`, que aparece
 *   para a equipe na ficha da OS, aba Arquivos.
 */
export const Route = createFileRoute("/_authenticated/portal-cliente")({
  head: () => ({ meta: [{ title: "Portal do Cliente — BEX PRINT OS" }] }),
  component: PortalClientePage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Portal não encontrado</div>,
});

function PortalClientePage() {
  const { user, hasPermission } = useAuth();
  const qc = useQueryClient();
  // A rota também abre para a equipe (clientes.read). Quem não tem
  // portal.read é da equipe: vê a explicação, não um portal vazio.
  const ehCliente = hasPermission("portal.read");
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const painel = useQuery({
    queryKey: ["portal-meu-painel", user?.id, escolhido],
    enabled: !!user?.id && ehCliente,
    queryFn: async (): Promise<PainelDaConta> => {
      const { data, error } = await (supabase.rpc as any)("portal_meu_painel", {
        p_cliente_id: escolhido,
      });
      if (error) throw error;
      return data as PainelDaConta;
    },
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["portal-meu-painel"] });

  if (!ehCliente) return <VistaDaEquipe />;

  if (painel.isPending) {
    return (
      <Moldura>
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando o seu acompanhamento…
        </div>
      </Moldura>
    );
  }

  if (painel.isError) {
    return (
      <Moldura>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar o portal</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{mensagemErro(painel.error)}</p>
            <p>Isto é uma falha de consulta, não uma lista vazia.</p>
            <Button variant="outline" size="sm" onClick={() => void painel.refetch()}>
              Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  const p = painel.data;
  if (p.situacao !== "aberto") {
    return (
      <Moldura>
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">
              Sua conta ainda não foi liberada para acompanhar um cliente.
            </p>
            <p className="text-sm text-muted-foreground">
              Fale com a equipe BEX PRINT e informe este e-mail — a liberação é feita no cadastro do
              cliente, na aba Portal, e vale na hora.
            </p>
            {user?.email && <p className="text-sm font-medium">{user.email}</p>}
          </CardContent>
        </Card>
      </Moldura>
    );
  }

  const clienteId = p.cliente.id;
  const resumo = resumoDoPortal(p);
  const artes = p.ordens.flatMap((o) =>
    o.artes_para_aprovar.map((a) => ({ arte: a, osNumero: o.numero, osTitulo: o.titulo })),
  );

  /**
   * O banco diz se o arquivo é de um pedido deste cliente e devolve o caminho;
   * a URL assinada sai do Storage, que confere de novo pela policy.
   */
  const obterUrl: ObterUrl = async (alvo) => {
    const { data, error } = await (supabase.rpc as any)("portal_meu_objeto", {
      p_tipo: alvo.tipo,
      p_id: alvo.id,
    });
    if (error) throw error;
    const objeto = data as { bucket: string; caminho: string; nome: string };
    const { data: assinada, error: erroDaUrl } = await supabase.storage
      .from(objeto.bucket)
      .createSignedUrl(
        objeto.caminho,
        600,
        alvo.para === "baixar" ? { download: objeto.nome } : undefined,
      );
    if (erroDaUrl || !assinada?.signedUrl) {
      throw erroDaUrl ?? new Error("Não foi possível gerar o link do arquivo.");
    }
    return assinada.signedUrl;
  };

  async function enviarArquivo(dados: {
    tipo: TipoDeEnvio;
    osId: string | null;
    arquivo: File;
    mensagem: string;
  }): Promise<Recibo> {
    const caminho = caminhoDoEnvio({ clienteId, osId: dados.osId, nome: dados.arquivo.name });
    const { error: erroDoEnvio } = await supabase.storage
      .from(bucketDoEnvio(dados.tipo))
      .upload(caminho, dados.arquivo, {
        upsert: false,
        contentType: dados.arquivo.type || undefined,
      });
    if (erroDoEnvio) throw erroDoEnvio;

    // Sem esta gravação o arquivo ficaria no Storage sem a equipe saber: é ela
    // que põe a linha na OS e abre a solicitação.
    const { data, error } = await (supabase.rpc as any)("portal_registrar_envio", {
      p_cliente_id: clienteId,
      p_os_id: dados.osId,
      p_tipo: dados.tipo,
      p_caminho: caminho,
      p_nome: dados.arquivo.name,
      p_mensagem: dados.mensagem.trim() || null,
    });
    if (error) throw error;
    await recarregar();
    return { protocolo: String(data?.protocolo ?? ""), os_numero: data?.os_numero ?? null };
  }

  return (
    <Moldura
      nome={p.cliente.nome}
      acoes={
        p.clientes.length > 1 ? (
          <Select value={clienteId} onValueChange={setEscolhido}>
            <SelectTrigger className="h-10 w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {p.clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusChip label="Acesso ativo" tone="lime" />
        )
      }
    >
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Em andamento" value={resumo.emAndamento} icon={Truck} tone="cyan" />
        <KpiCard
          label="Esperando você"
          value={resumo.esperandoVoce}
          icon={Hourglass}
          tone={resumo.esperandoVoce > 0 ? "amber" : "muted"}
        />
        <KpiCard label="Entregues" value={resumo.entregues} icon={PackageCheck} tone="lime" />
        {/* Preço dos pedidos em andamento: é o que o cliente comprou. */}
        <KpiCard
          label="Valor em andamento"
          value={formatarReal(resumo.valorEmAndamento)}
          icon={DollarSign}
          tone="cyan"
        />
      </div>

      {(artes.length > 0 || p.orcamentos.length > 0) && (
        <Secao titulo="Esperando você" descricao="Arte para aprovar e orçamento para responder.">
          <div className="space-y-3">
            {artes.map(({ arte, osNumero, osTitulo }) => (
              <ArteParaAprovarCartao
                key={arte.arquivo_id}
                arte={arte}
                osNumero={osNumero}
                osTitulo={osTitulo}
                obterUrl={obterUrl}
                onDecidir={async (decisao, comentario) => {
                  const { error } = await (supabase.rpc as any)("portal_decidir_arte", {
                    p_arquivo_id: arte.arquivo_id,
                    p_decisao: decisao,
                    p_comentario: comentario.trim() || null,
                  });
                  if (error) throw error;
                  await recarregar();
                }}
              />
            ))}
            <OrcamentosParaResponder orcamentos={p.orcamentos} />
          </div>
        </Secao>
      )}

      <Secao
        titulo="Suas ordens de serviço"
        descricao="Situação, previsão de entrega, valor e arquivos de cada pedido."
      >
        <ListaDePedidos ordens={p.ordens} obterUrl={obterUrl} />
      </Secao>

      <Secao
        titulo="Enviar arquivo ou comprovante"
        descricao="O arquivo entra no pedido e a equipe vê na ficha da OS; o comprovante vai para o financeiro conferir."
      >
        <EnvioDeArquivo key={clienteId} ordens={p.ordens} onEnviar={enviarArquivo} />
      </Secao>

      <Secao titulo="Falar com a equipe">
        <div className="space-y-4">
          <MensagemParaEquipe
            key={clienteId}
            ordens={p.ordens}
            onEnviar={async (dados) => {
              const { data, error } = await (supabase.rpc as any)("portal_enviar_mensagem", {
                p_cliente_id: clienteId,
                p_os_id: dados.osId,
                p_tipo: dados.tipo,
                p_mensagem: dados.mensagem.trim(),
              });
              if (error) throw error;
              await recarregar();
              return {
                protocolo: String(data?.protocolo ?? ""),
                os_numero: data?.os_numero ?? null,
              };
            }}
          />
          <ContatoDaEmpresa empresa={p.empresa} />
        </div>
      </Secao>

      <Secao titulo="O que você já mandou">
        <OQueVoceMandou solicitacoes={p.solicitacoes} comprovantes={p.comprovantes} />
      </Secao>
    </Moldura>
  );
}

function Moldura({
  nome,
  acoes,
  children,
}: {
  nome?: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/portal-cliente")}
        breadcrumb={nome ? `Portal · ${nome}` : "Área do Cliente"}
        title="Seu acompanhamento BEX PRINT"
        description="Pedidos em produção, arte para aprovar, arquivos e documentos"
        actions={acoes}
      />
      {children}
    </div>
  );
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
        {descricao && <CardDescription>{descricao}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * A rota abre para quem tem clientes.read, mas o portal é do CLIENTE. Para a
 * equipe, uma explicação de como dar acesso — e não um "sua conta não foi
 * liberada", que lia como defeito.
 */
function VistaDaEquipe() {
  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/portal-cliente")}
        breadcrumb="Área do Cliente"
        title="Portal do Cliente"
        description="Esta é a tela que o cliente vê quando entra com o login dele"
      />
      <Card>
        <CardContent className="space-y-3 py-8 text-sm">
          <p>
            O cliente acompanha aqui os pedidos dele: situação, previsão de entrega, valor do
            pedido, arte para aprovar, arquivos e documentos, e manda arquivo, comprovante e
            mensagem.
          </p>
          <p className="text-muted-foreground">
            Dois jeitos de dar acesso, os dois na ficha do cliente, aba <strong>Portal</strong>:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong>Gerar link</strong> — o cliente abre no celular, sem login. É o caminho mais
              simples para quem pede pelo WhatsApp.
            </li>
            <li>
              <strong>Liberar uma conta</strong> — para quem criou login no sistema; ele entra e cai
              nesta tela.
            </li>
          </ul>
          <Button asChild variant="outline">
            <Link to="/clientes">Abrir Clientes</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
