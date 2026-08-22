import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { AlertTriangle, KeyRound, Pencil, Power, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { AppRole } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import {
  criarUsuarioComPapel,
  motivoParaNaoDesativar,
  motivoParaNaoRemoverPapel,
} from "@/lib/criar-usuario";
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
  const [editando, setEditando] = useState<any | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["usuarios-admin"],
    queryFn: async () => {
      const { data: usuarios } = await supabase
        .from("usuarios")
        .select("id, nome, email, telefone, ativo, cargo_pretendido, created_at")
        .order("nome");
      const { data: roles } = await supabase.from("user_roles").select("*");
      const lista = (usuarios ?? []).map((u) => ({
        ...u,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
      // Quem está sem papel vai para o topo: é a única linha que exige ação.
      return lista.sort((a, b) => a.roles.length - b.roles.length);
    },
  });

  const totalDeAdmins = users.filter((u: any) => u.roles.includes("admin")).length;
  const totalDeAdminsAtivos = users.filter(
    (u: any) => u.roles.includes("admin") && u.ativo !== false,
  ).length;
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

  async function liberarComoPediu(u: any) {
    // "administrador" é o rótulo do cadastro; o papel no sistema é `admin`.
    const papel = (u.cargo_pretendido === "administrador" ? "admin" : u.cargo_pretendido) as AppRole;
    if (!ROLES.includes(papel)) {
      return toast.error(`"${u.cargo_pretendido}" não corresponde a um perfil. Escolha na lista.`);
    }
    if (!window.confirm(`Liberar ${u.nome} como ${papel}?`)) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: u.id, role: papel });
    if (error) return toast.error(error.message);
    toast.success(`${u.nome} liberado como ${papel}`);
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  async function alternarAtivo(u: any) {
    const impedimento = motivoParaNaoDesativar({
      usuarioId: u.id,
      usuarioLogadoId: user?.id ?? null,
      ehAdmin: u.roles.includes("admin"),
      totalDeAdminsAtivos,
    });
    // Só barra ao DESATIVAR: religar alguém nunca deixa o sistema sem dono.
    if (u.ativo !== false && impedimento) return toast.error(impedimento);

    const novo = u.ativo === false;
    if (
      !novo &&
      !window.confirm(
        `Desativar ${u.nome}? A pessoa perde o acesso imediatamente, mas o histórico dela continua no sistema.`,
      )
    )
      return;

    const { data, error } = await supabase
      .from("usuarios")
      .update({ ativo: novo })
      .eq("id", u.id)
      .select("id");
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) {
      return toast.error("Seu perfil não tem permissão para alterar usuários.");
    }
    toast.success(novo ? "Acesso reativado" : "Acesso desativado");
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  async function enviarRedefinicaoDeSenha(u: any) {
    // Trocar a senha de outra pessoa exigiria a chave de serviço, que não vive no
    // navegador. O caminho honesto é a própria pessoa redefinir pelo e-mail.
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(error.message);
    toast.success(`Enviamos o link de redefinição para ${u.email}`);
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
            {semPapel === 1 ? "Uma pessoa se cadastrou e está" : `${semPapel} pessoas se cadastraram e estão`}{" "}
            aguardando liberação. Sem papel, elas entram e veem apenas um aviso de espera.
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
                <TableHead className="text-right">Conta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {users.map((u: any) => (
                <TableRow key={u.id} className={u.ativo === false ? "opacity-55" : undefined}>
                  <TableCell className="font-medium">
                    {u.nome}
                    {u.id === user?.id && (
                      <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                    )}
                    {u.ativo === false && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        desativado
                      </Badge>
                    )}
                    {u.telefone && (
                      <div className="text-xs text-muted-foreground">{u.telefone}</div>
                    )}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && (
                        <span className="text-xs text-muted-foreground">Aguardando liberação</span>
                      )}
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
                    {/* O que a pessoa declarou no cadastro. É sugestão: liberar
                        continua sendo uma decisão explícita de quem administra. */}
                    {u.roles.length === 0 && u.cargo_pretendido && (
                      <button
                        type="button"
                        onClick={() => liberarComoPediu(u)}
                        className="mt-1 text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                      >
                        pediu acesso como <strong>{u.cargo_pretendido}</strong> — liberar assim
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar nome e telefone"
                      aria-label={`Editar ${u.nome}`}
                      onClick={() => setEditando(u)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Enviar link de redefinição de senha"
                      aria-label={`Redefinir senha de ${u.nome}`}
                      onClick={() => enviarRedefinicaoDeSenha(u)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={u.ativo === false ? "Reativar acesso" : "Desativar acesso"}
                      aria-label={`${u.ativo === false ? "Reativar" : "Desativar"} ${u.nome}`}
                      onClick={() => alternarAtivo(u)}
                    >
                      <Power
                        className={`h-4 w-4 ${u.ativo === false ? "text-muted-foreground" : ""}`}
                      />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EditarPessoaDialog
        pessoa={editando}
        onOpenChange={(v) => !v && setEditando(null)}
        onSalvo={() => qc.invalidateQueries({ queryKey: ["usuarios-admin"] })}
      />

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

/**
 * Editar cadastro.
 *
 * Só nome e telefone: o e-mail é a identidade de login e vive em auth.users —
 * mudar aqui deixaria os dois lados divergentes e a pessoa entrando pelo e-mail
 * antigo. Trocar e-mail é operação da própria pessoa, pela conta dela.
 */
function EditarPessoaDialog({
  pessoa,
  onOpenChange,
  onSalvo,
}: {
  pessoa: { id: string; nome: string; email: string; telefone: string | null } | null;
  onOpenChange: (v: boolean) => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (pessoa) {
      setNome(pessoa.nome ?? "");
      setTelefone(pessoa.telefone ?? "");
    }
  }, [pessoa]);

  async function salvar() {
    if (!pessoa) return;
    if (!nome.trim()) return toast.error("Informe o nome");
    setSalvando(true);
    const { data, error } = await supabase
      .from("usuarios")
      .update({ nome: nome.trim(), telefone: telefone.trim() || null })
      .eq("id", pessoa.id)
      .select("id");
    setSalvando(false);
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) {
      return toast.error("Seu perfil não tem permissão para editar usuários.");
    }
    toast.success("Cadastro atualizado");
    onOpenChange(false);
    onSalvo();
  }

  return (
    <Dialog open={!!pessoa} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>
            O e-mail não muda por aqui: ele é o login da pessoa e a troca precisa ser feita
            por ela, na própria conta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="edit-nome">Nome</Label>
            <Input id="edit-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-telefone">Telefone</Label>
            <Input
              id="edit-telefone"
              placeholder="(96) 99111-6169"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input value={pessoa?.email ?? ""} readOnly className="bg-muted/40" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
