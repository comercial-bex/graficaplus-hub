import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { AppRole } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import { criarUsuarioComPapel, motivoParaNaoRemoverPapel } from "@/lib/criar-usuario";
import { rolePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — BEX PRINT OS" }] }),
  component: UsuariosPage,
});

const ROLES: AppRole[] = ["admin","gestor","financeiro","vendedor","designer","operador","estoque","instalador","cliente"];

/** O que cada papel faz, em uma linha — escolher "operador" sem saber é o normal. */
const descricaoDoPapel: Record<AppRole, string> = {
  admin: "Acesso total, inclusive usuários e configurações",
  gestor: "Comercial, produção e financeiro; aprova arte e orçamento",
  financeiro: "Pagamentos, custos e resultado",
  vendedor: "Clientes, leads, orçamentos e WhatsApp",
  designer: "Arquivos, arte e tarefas da OS",
  operador: "Produção, agenda de máquina e apontamento",
  estoque: "Entrada, saída, inventário e recibo de material",
  instalador: "Entregas e instalações",
  cliente: "Só o portal do cliente",
};

function UsuariosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [novoRole, setNovoRole] = useState<Record<string, AppRole>>({});
  const [criarAberto, setCriarAberto] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["usuarios-admin"],
    queryFn: async () => {
      const { data: usuarios } = await supabase.from("usuarios").select("*").order("nome");
      const { data: roles } = await supabase.from("user_roles").select("*");
      return (usuarios ?? []).map((u) => ({
        ...u,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
    },
  });

  const totalDeAdmins = users.filter((u: any) => u.roles.includes("admin")).length;
  const semPapel = users.filter((u: any) => u.roles.length === 0).length;

  async function addRole(userId: string) {
    const role = novoRole[userId];
    if (!role) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success("Papel atribuído");
    setNovoRole((r) => ({ ...r, [userId]: undefined as unknown as AppRole }));
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  async function removeRole(userId: string, role: string) {
    const impedimento = motivoParaNaoRemoverPapel({
      papel: role,
      usuarioId: userId,
      usuarioLogadoId: user?.id ?? null,
      totalDeAdmins,
    });
    if (impedimento) return toast.error(impedimento);

    const pessoa = users.find((u: any) => u.id === userId) as any;
    if (!window.confirm(`Remover o papel "${role}" de ${pessoa?.nome ?? "esta pessoa"}?`)) return;

    // Escrita barrada por RLS devolve 0 linhas e nenhum erro — sem conferir o
    // retorno, o papel sumiria da tela e continuaria valendo no banco.
    const { data, error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role as any)
      .select("role");
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) {
      return toast.error("Seu perfil não tem permissão para remover papéis.");
    }
    toast.success("Papel removido");
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários &amp; Permissões</h1>
          <p className="text-muted-foreground">
            Quem entra no sistema e o que cada um enxerga
          </p>
        </div>
        <Button onClick={() => setCriarAberto(true)}>
          <UserPlus className="h-4 w-4 mr-1" /> Adicionar pessoa
        </Button>
      </div>

      {semPapel > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            {semPapel === 1 ? "Uma pessoa está" : `${semPapel} pessoas estão`} sem papel. Quem
            não tem papel consegue entrar e não enxerga tela nenhuma — o acesso é negado por
            padrão.
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfis</TableHead>
                <TableHead>Atribuir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {users.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.nome}
                    {u.id === user?.id && (
                      <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                    )}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-xs text-muted-foreground">Sem papel</span>}
                      {u.roles.map((r: string) => (
                        <Badge key={r} variant="secondary" className="gap-1">
                          {r}
                          <button
                            type="button"
                            aria-label={`Remover papel ${r} de ${u.nome}`}
                            onClick={() => removeRole(u.id, r)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Select
                        value={novoRole[u.id] ?? ""}
                        onValueChange={(v: AppRole) => setNovoRole({ ...novoRole, [u.id]: v })}
                      >
                        <SelectTrigger className="w-44"><SelectValue placeholder="Perfil" /></SelectTrigger>
                        <SelectContent>
                          {ROLES.filter((r) => !u.roles.includes(r)).map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {rolePermissions[r].length} permissões
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => addRole(u.id)} disabled={!novoRole[u.id]}>
                        +
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CriarPessoaDialog
        open={criarAberto}
        onOpenChange={setCriarAberto}
        onCriado={() => qc.invalidateQueries({ queryKey: ["usuarios-admin"] })}
      />
    </div>
  );
}

function CriarPessoaDialog({
  open,
  onOpenChange,
  onCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: () => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [papel, setPapel] = useState<AppRole | "">("");
  const [salvando, setSalvando] = useState(false);

  function limpar() {
    setNome("");
    setEmail("");
    setSenha("");
    setPapel("");
  }

  async function salvar() {
    if (!nome.trim()) return toast.error("Informe o nome");
    if (!email.includes("@")) return toast.error("E-mail inválido");
    if (senha.length < 8) return toast.error("A senha provisória precisa de ao menos 8 caracteres");
    if (!papel) return toast.error("Escolha o perfil");

    setSalvando(true);
    const r = await criarUsuarioComPapel({ nome, email, senha, papel });
    setSalvando(false);

    if (!r.ok) return toast.error(r.erro);
    toast.success(
      r.precisaConfirmarEmail
        ? "Conta criada. A pessoa precisa confirmar o e-mail antes de entrar."
        : "Conta criada. Já pode entrar com a senha provisória.",
    );
    limpar();
    onOpenChange(false);
    onCriado();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) limpar();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar pessoa</DialogTitle>
          <DialogDescription>
            A conta é criada já com o perfil escolhido. Combine a senha provisória com a
            pessoa — ela pode trocar depois em &quot;esqueci minha senha&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="novo-nome">Nome</Label>
            <Input id="novo-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="novo-email">E-mail</Label>
            <Input
              id="novo-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="nova-senha">Senha provisória</Label>
            <Input
              id="nova-senha"
              type="text"
              autoComplete="off"
              placeholder="mínimo 8 caracteres"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          <div>
            <Label>Perfil</Label>
            <Select value={papel} onValueChange={(v: AppRole) => setPapel(v)}>
              <SelectTrigger><SelectValue placeholder="O que essa pessoa faz" /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="font-medium">{r}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {descricaoDoPapel[r]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Criando…" : "Criar conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
