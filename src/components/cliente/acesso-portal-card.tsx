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
import { KeyRound, Search, UserPlus, Power, Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

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
      <GerenciarAcessos clienteId={clienteId} />
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
          Quem estiver aqui acompanha as OS, os documentos e os pagamentos deste cliente pelo
          portal. A pessoa precisa ter criado o login antes — o convite liga uma conta
          existente, não cria conta.
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
