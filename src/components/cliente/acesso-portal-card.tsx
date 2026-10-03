/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any` e tabelas fora dos tipos gerados (portal_comprovantes, funções portal_*) */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  KeyRound,
  Search,
  UserPlus,
  Power,
  Trash2,
  MessageSquare,
  Link2,
  Copy,
  Check,
  Ban,
  Receipt,
  Eye,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import {
  VALIDADE_PADRAO_DIAS,
  VALIDADE_MAXIMA_DIAS,
  dataCurta,
  linkDoWhatsapp,
  mensagemDoLink,
  situacaoDoLink,
  textoDoLink,
  urlDoPortal,
  validadeEmDias,
  type LinkDoPortal,
} from "@/domain/portal/link-do-portal";

type Acesso = {
  id: string;
  usuario_id: string;
  ativo: boolean;
  created_at: string;
  usuario?: { nome: string | null; email: string | null } | null;
};

type Candidato = { id: string; nome: string | null; email: string | null };

/**
 * Quem, do lado do cliente, enxerga a produção pelo portal.
 *
 * O vínculo nunca teve tela: `portal_cliente_acessos` só tinha policy de SELECT,
 * então nem admin conseguia criar a linha e a própria página do portal mandava o
 * cliente pedir que alguém "cadastrasse o acesso na tabela".
 *
 * O convite não cria login: quem cria a conta é a própria pessoa, pela tela de
 * cadastro. Aqui só se liga uma conta existente ao cliente — criar usuário exige
 * chave de serviço, que não vive no navegador.
 */
export function AcessoPortalCard({ clienteId }: { clienteId: string }) {
  return (
    <div className="space-y-4">
      <LinkDoPortalCard clienteId={clienteId} />
      <GerenciarAcessos clienteId={clienteId} />
      <ComprovantesDoPortal clienteId={clienteId} />
      <SolicitacoesDoPortal clienteId={clienteId} />
    </div>
  );
}

function GerenciarAcessos({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [procurando, setProcurando] = useState(false);

  const { data: acessos = [], isLoading } = useQuery({
    queryKey: ["portal-acessos-cliente", clienteId],
    queryFn: async (): Promise<Acesso[]> => {
      const { data, error } = await (supabase as any)
        .from("portal_cliente_acessos")
        .select("id, usuario_id, ativo, created_at")
        .eq("cliente_id", clienteId)
        .order("created_at");
      if (error) throw error;

      const linhas = (data ?? []) as Acesso[];
      if (linhas.length === 0) return linhas;

      // `usuarios` só é legível por admin/gestor. Quando não vier, a linha mostra
      // o id em vez de sumir — some seria pior: o acesso existe de qualquer forma.
      const { data: usuarios } = await supabase
        .from("usuarios")
        .select("id, nome, email")
        .in(
          "id",
          linhas.map((l) => l.usuario_id),
        );
      const porId = new Map((usuarios ?? []).map((u: any) => [u.id, u]));
      return linhas.map((l) => ({ ...l, usuario: porId.get(l.usuario_id) ?? null }));
    },
  });

  async function procurar() {
    if (busca.trim().length < 3) {
      return toast.error("Digite ao menos 3 letras do e-mail ou do nome");
    }
    setProcurando(true);
    const { data, error } = await (supabase.rpc as any)("buscar_usuario_para_portal", {
      p_busca: busca.trim(),
    });
    setProcurando(false);
    if (error) return toast.error(error.message);
    const achados = (data ?? []) as Candidato[];
    setCandidatos(achados);
    if (achados.length === 0) {
      toast.info("Ninguém encontrado. A pessoa precisa criar o login antes de ser vinculada.");
    }
  }

  const vincular = useMutation({
    mutationFn: async (usuarioId: string) => {
      const { error } = await (supabase.rpc as any)("vincular_usuario_ao_portal", {
        p_usuario_id: usuarioId,
        p_cliente_id: clienteId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acesso liberado — a pessoa já vê a produção no portal");
      setCandidatos(null);
      setBusca("");
      qc.invalidateQueries({ queryKey: ["portal-acessos-cliente", clienteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao vincular"),
  });

  const alternar = useMutation({
    mutationFn: async (acesso: Acesso) => {
      // Escrita barrada por RLS volta 0 linhas e NENHUM erro: sem conferir o
      // retorno, a tela diria "desativado" com o acesso seguindo ativo.
      const { data, error } = await (supabase as any)
        .from("portal_cliente_acessos")
        .update({ ativo: !acesso.ativo })
        .eq("id", acesso.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para alterar o acesso ao portal.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-acessos-cliente", clienteId] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao alterar"),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any)
        .from("portal_cliente_acessos")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para remover o acesso ao portal.");
      }
    },
    onSuccess: () => {
      toast.success("Acesso removido");
      qc.invalidateQueries({ queryKey: ["portal-acessos-cliente", clienteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Acesso ao portal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Quem estiver aqui entra com login e acompanha as OS, os documentos e as artes deste
          cliente pelo portal. A pessoa precisa ter criado o login antes — o convite liga uma conta
          existente, não cria conta. Para quem não tem login, use o link acima.
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="E-mail ou nome de quem vai acompanhar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && procurar()}
          />
          <Button variant="outline" onClick={procurar} disabled={procurando}>
            <Search className="h-4 w-4 mr-1" />
            {procurando ? "Procurando…" : "Procurar"}
          </Button>
        </div>

        {candidatos !== null && candidatos.length > 0 && (
          <div className="rounded-md border divide-y">
            {candidatos.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.nome ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                </div>
                <Button
                  size="sm"
                  disabled={vincular.isPending}
                  onClick={() => vincular.mutate(c.id)}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Liberar
                </Button>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : acessos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Ninguém deste cliente acessa o portal ainda.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {acessos.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.usuario?.nome ?? "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.usuario?.email ?? a.usuario_id}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.ativo ? "secondary" : "outline"}>
                      {a.ativo ? "ativo" : "desativado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={a.ativo ? "Desativar acesso" : "Reativar acesso"}
                      aria-label={a.ativo ? "Desativar acesso" : "Reativar acesso"}
                      disabled={alternar.isPending}
                      onClick={() => alternar.mutate(a)}
                    >
                      <Power className={`h-4 w-4 ${a.ativo ? "" : "text-muted-foreground"}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover acesso"
                      aria-label="Remover acesso"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(a.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type Solicitacao = {
  id: string;
  tipo: string;
  mensagem: string;
  status: string;
  created_at: string;
  os_id: string | null;
  orcamento_id: string | null;
};

/**
 * O que o cliente escreveu pelo portal.
 *
 * A policy de `portal_cliente_solicitacoes` só permitia leitura pelo próprio
 * cliente — dúvida enviada pelo portal não era lida por ninguém da gráfica. O
 * formulário existia dos dois lados da parede e a mensagem morria no meio.
 */
function SolicitacoesDoPortal({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();

  const { data: solicitacoes = [], isLoading } = useQuery({
    queryKey: ["portal-solicitacoes", clienteId],
    queryFn: async (): Promise<Solicitacao[]> => {
      const { data, error } = await (supabase as any)
        .from("portal_cliente_solicitacoes")
        .select("id, tipo, mensagem, status, created_at, os_id, orcamento_id")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
  });

  const resolver = useMutation({
    mutationFn: async (s: Solicitacao) => {
      const novo = s.status === "resolvida" ? "aberta" : "resolvida";
      const { data, error } = await (supabase as any)
        .from("portal_cliente_solicitacoes")
        .update({ status: novo })
        .eq("id", s.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para alterar a solicitação.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-solicitacoes", clienteId] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar"),
  });

  const abertas = solicitacoes.filter((s) => s.status !== "resolvida").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Mensagens do portal
          {abertas > 0 && <Badge variant="destructive">{abertas} em aberto</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">Carregando…</div>
        ) : solicitacoes.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">
            Nenhuma mensagem enviada por este cliente pelo portal.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {solicitacoes.map((s) => (
                <TableRow key={s.id} className={s.status === "resolvida" ? "opacity-60" : ""}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(s.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize font-normal">
                      {s.tipo}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-pre-wrap">{s.mensagem}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant={s.status === "resolvida" ? "ghost" : "outline"}
                      size="sm"
                      disabled={resolver.isPending}
                      onClick={() => resolver.mutate(s)}
                    >
                      {s.status === "resolvida" ? "Reabrir" : "Marcar resolvida"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Link do portal (sem login)                                                 */
/* ------------------------------------------------------------------------- */

type ListaDeLinks = { agora: string; links: LinkDoPortal[] };

/**
 * O link que o cliente abre no celular, sem login, para acompanhar os pedidos,
 * aprovar a arte e mandar arquivo e comprovante (/publico/$token).
 *
 * O token é sorteado pelo banco e aparece em claro UMA vez, nesta tela, logo
 * depois de gerar — o banco guarda só o hash. Por isso o link fica na tela até
 * alguém copiar ou mandar pelo WhatsApp. Perdeu? Gera outro: o novo cancela o
 * anterior (um link vivo por cliente).
 */
function LinkDoPortalCard({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeGerar = hasPermission("clientes.update");
  const [dias, setDias] = useState(String(VALIDADE_PADRAO_DIAS));
  const [gerado, setGerado] = useState<{ url: string; venceEm: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["portal-links", clienteId],
    queryFn: async (): Promise<ListaDeLinks> => {
      const { data, error } = await (supabase.rpc as any)("portal_links_do_cliente", {
        p_cliente_id: clienteId,
      });
      if (error) throw error;
      return data as ListaDeLinks;
    },
  });

  // Nome e telefone para a mensagem pronta do WhatsApp.
  const contato = useQuery({
    queryKey: ["portal-links-contato", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("nome, whatsapp_principal, telefone")
        .eq("id", clienteId)
        .single();
      if (error) throw error;
      return data as { nome: string; whatsapp_principal: string | null; telefone: string | null };
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("portal_gerar_link", {
        p_cliente_id: clienteId,
        p_dias: validadeEmDias(dias),
      });
      if (error) throw error;
      return data as { token: string; expira_em: string; cancelados: number };
    },
    onSuccess: (r) => {
      setGerado({ url: urlDoPortal(window.location.origin, r.token), venceEm: r.expira_em });
      setCopiado(false);
      toast.success(
        r.cancelados > 0
          ? "Link novo gerado. O link anterior deste cliente deixou de abrir."
          : "Link gerado. Copie ou mande pelo WhatsApp agora — ele não aparece de novo.",
      );
      qc.invalidateQueries({ queryKey: ["portal-links", clienteId] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Não foi possível gerar o link.")),
  });

  const cancelar = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await (supabase.rpc as any)("portal_revogar_link", { p_link_id: linkId });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmarCancelamento(null);
      setGerado(null);
      toast.success("Link cancelado. Quem tiver o endereço vê 'Link inválido ou vencido'.");
      qc.invalidateQueries({ queryKey: ["portal-links", clienteId] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Não foi possível cancelar o link.")),
  });

  async function copiar() {
    if (!gerado) return;
    try {
      await navigator.clipboard.writeText(gerado.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não consegui copiar. Selecione o endereço e copie à mão.");
    }
  }

  const agora = lista.data ? new Date(lista.data.agora) : new Date();
  const links = lista.data?.links ?? [];
  const ativo = links.find((l) => situacaoDoLink(l, agora) === "ativo") ?? null;
  const anteriores = links.filter((l) => l.id !== ativo?.id).slice(0, 3);
  const telefone = contato.data?.whatsapp_principal ?? contato.data?.telefone ?? null;
  const whatsapp = gerado
    ? linkDoWhatsapp(telefone, mensagemDoLink(contato.data?.nome, gerado.url, gerado.venceEm))
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Link do portal (sem login)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          O cliente abre no celular e vê os pedidos dele, a situação, a previsão de entrega e o
          valor; aprova a arte e manda arquivo ou comprovante. Tudo que ele manda aparece aqui e na
          ficha da OS.
        </p>

        {lista.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Não foi possível carregar os links</AlertTitle>
            <AlertDescription>{mensagemErro(lista.error)}</AlertDescription>
          </Alert>
        ) : lista.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : ativo ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div className="text-sm">
              <Badge variant="secondary" className="mr-2">
                ativo
              </Badge>
              {textoDoLink(ativo, agora)}
              {ativo.criado_por ? ` · gerado por ${ativo.criado_por}` : ""}
            </div>
            {podeGerar &&
              (confirmarCancelamento === ativo.id ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate(ativo.id)}
                  >
                    Confirmar cancelamento
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarCancelamento(null)}>
                    Voltar
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmarCancelamento(ativo.id)}
                >
                  <Ban className="mr-1 h-3.5 w-3.5" /> Cancelar link
                </Button>
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Este cliente não tem link ativo.
            {links.length > 0 ? " O último já venceu ou foi cancelado." : ""}
          </p>
        )}

        {gerado && (
          <div className="space-y-2 rounded-md border border-[color:var(--bex-amber)]/50 bg-[color:var(--bex-amber)]/5 p-3">
            <div className="text-sm font-medium">
              Copie agora: este endereço não aparece de novo (o sistema guarda só uma impressão
              digital dele).
            </div>
            <Input readOnly value={gerado.url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copiar()}>
                {copiado ? (
                  <Check className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" />
                )}
                {copiado ? "Copiado" : "Copiar link"}
              </Button>
              {whatsapp ? (
                <Button size="sm" asChild>
                  <a href={whatsapp} target="_blank" rel="noreferrer">
                    <MessageSquare className="mr-1 h-3.5 w-3.5" /> Mandar pelo WhatsApp
                  </a>
                </Button>
              ) : (
                <span className="self-center text-xs text-muted-foreground">
                  {contato.isError
                    ? `Não consegui ler o telefone do cliente (${mensagemErro(contato.error)}): copie e mande à mão.`
                    : "Sem celular no cadastro: copie e mande à mão."}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Vale até {dataCurta(gerado.venceEm)}.
            </div>
          </div>
        )}

        {podeGerar ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="portal-link-dias" className="text-xs">
                Validade (dias, até {VALIDADE_MAXIMA_DIAS})
              </Label>
              <Input
                id="portal-link-dias"
                type="number"
                min={1}
                max={VALIDADE_MAXIMA_DIAS}
                className="w-24"
                value={dias}
                onChange={(e) => setDias(e.target.value)}
              />
            </div>
            <Button onClick={() => gerar.mutate()} disabled={gerar.isPending || lista.isPending}>
              {gerar.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-1 h-4 w-4" />
              )}
              {ativo ? "Gerar novo link (cancela o atual)" : "Gerar link"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Gerar e cancelar o link pede a permissão de editar clientes.
          </p>
        )}

        {anteriores.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="font-medium uppercase tracking-wide">Links anteriores</div>
            {anteriores.map((l) => (
              <div key={l.id}>
                Gerado em {dataCurta(l.criado_em)} · {textoDoLink(l, agora)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Comprovantes mandados pelo portal (só o financeiro)                        */
/* ------------------------------------------------------------------------- */

type ComprovanteDoPortal = {
  id: string;
  os_id: string | null;
  nome: string;
  caminho: string;
  observacao: string | null;
  situacao: "a_conferir" | "conferido" | "recusado";
  origem: "portal" | "link";
  created_at: string;
  conferido_em: string | null;
  nota_da_conferencia: string | null;
  os_numero?: number | null;
};

/**
 * O comprovante que o cliente manda pelo portal vai para o bucket
 * `comprovantes` e para `portal_comprovantes`, que só quem vê dinheiro lê — não
 * entra em `arquivos`, onde o impressor veria o valor pago. Aqui o financeiro
 * abre, confere e marca; "recusado" leva o motivo, que o cliente vê no portal.
 * Conferir NÃO dá baixa em nada: a baixa continua sendo feita em Contas a
 * receber, onde o pagamento é registrado.
 */
function ComprovantesDoPortal({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const { canSeeFinancials, hasPermission } = useAuth();
  const podeConferir = hasPermission("pagamentos.confirm");
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const lista = useQuery({
    queryKey: ["portal-comprovantes", clienteId],
    enabled: canSeeFinancials,
    queryFn: async (): Promise<ComprovanteDoPortal[]> => {
      const { data, error } = await (supabase as any)
        .from("portal_comprovantes")
        .select(
          "id, os_id, nome, caminho, observacao, situacao, origem, created_at, conferido_em, nota_da_conferencia",
        )
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const linhas = (data ?? []) as ComprovanteDoPortal[];
      const ids = [...new Set(linhas.map((l) => l.os_id).filter(Boolean))] as string[];
      if (ids.length === 0) return linhas;
      const { data: ordens, error: erroOs } = await supabase
        .from("ordens_servico")
        .select("id, numero")
        .in("id", ids);
      if (erroOs) throw erroOs;
      const numero = new Map((ordens ?? []).map((o) => [o.id, o.numero]));
      return linhas.map((l) => ({
        ...l,
        os_numero: l.os_id ? (numero.get(l.os_id) ?? null) : null,
      }));
    },
  });

  const conferir = useMutation({
    mutationFn: async (p: {
      id: string;
      situacao: "conferido" | "recusado";
      nota: string | null;
    }) => {
      const { error } = await (supabase.rpc as any)("portal_conferir_comprovante", {
        p_id: p.id,
        p_situacao: p.situacao,
        p_nota: p.nota,
      });
      if (error) throw error;
    },
    onSuccess: (_r, p) => {
      setRecusando(null);
      setMotivo("");
      toast.success(
        p.situacao === "conferido"
          ? "Comprovante conferido. Registre o pagamento em Contas a receber, se ainda não registrou."
          : "Comprovante recusado. O cliente vê o motivo no portal.",
      );
      qc.invalidateQueries({ queryKey: ["portal-comprovantes", clienteId] });
      qc.invalidateQueries({ queryKey: ["portal-solicitacoes", clienteId] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e: unknown) =>
      toast.error(mensagemErro(e, "Não foi possível registrar a conferência.")),
  });

  async function abrir(c: ComprovanteDoPortal) {
    const janela = window.open("", "_blank");
    const { data, error } = await supabase.storage
      .from("comprovantes")
      .createSignedUrl(c.caminho, 120);
    if (error || !data?.signedUrl) {
      janela?.close();
      toast.error(mensagemErro(error, "Não foi possível abrir o comprovante."));
      return;
    }
    if (janela) janela.location.href = data.signedUrl;
    else window.location.assign(data.signedUrl);
  }

  // Quem não vê dinheiro não vê nem o bloco: a tabela já não devolveria linha.
  if (!canSeeFinancials) return null;

  const aConferir = (lista.data ?? []).filter((c) => c.situacao === "a_conferir").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Comprovantes enviados pelo cliente
          {aConferir > 0 && <Badge variant="destructive">{aConferir} a conferir</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lista.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Não foi possível carregar os comprovantes</AlertTitle>
            <AlertDescription>{mensagemErro(lista.error)}</AlertDescription>
          </Alert>
        ) : lista.isPending ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (lista.data ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhum comprovante enviado por este cliente pelo portal.
          </div>
        ) : (
          (lista.data ?? []).map((c) => (
            <div key={c.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("pt-BR")}
                    {c.os_numero ? ` · OS #${c.os_numero}` : " · sem OS indicada"}
                    {c.origem === "link" ? " · pelo link" : " · pelo login do cliente"}
                  </div>
                </div>
                <Badge
                  variant={
                    c.situacao === "recusado"
                      ? "destructive"
                      : c.situacao === "conferido"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {c.situacao === "a_conferir" ? "a conferir" : c.situacao}
                </Badge>
              </div>
              {c.observacao && (
                <p className="whitespace-pre-wrap text-muted-foreground">Recado: {c.observacao}</p>
              )}
              {c.nota_da_conferencia && (
                <p className="text-xs text-muted-foreground">
                  Nota da conferência: {c.nota_da_conferencia}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void abrir(c)}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> Ver comprovante
                </Button>
                {podeConferir && c.situacao === "a_conferir" && recusando !== c.id && (
                  <>
                    <Button
                      size="sm"
                      disabled={conferir.isPending}
                      onClick={() =>
                        conferir.mutate({ id: c.id, situacao: "conferido", nota: null })
                      }
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Conferido
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRecusando(c.id)}>
                      Recusar
                    </Button>
                  </>
                )}
              </div>
              {recusando === c.id && (
                <div className="space-y-2">
                  <Label htmlFor={`motivo-${c.id}`} className="text-xs">
                    Motivo (aparece para o cliente no portal)
                  </Label>
                  <Textarea
                    id={`motivo-${c.id}`}
                    rows={2}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: o valor do comprovante não confere com o pedido."
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={conferir.isPending}
                      onClick={() =>
                        conferir.mutate({ id: c.id, situacao: "recusado", nota: motivo })
                      }
                    >
                      Recusar comprovante
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRecusando(null)}>
                      Voltar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {!podeConferir && (
          <p className="text-xs text-muted-foreground">
            Marcar como conferido pede a permissão de confirmar pagamentos.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
