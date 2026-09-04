import { createFileRoute } from "@tanstack/react-router";
import { mensagemErro } from "@/lib/erros";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  KeyRound,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { NeonButton } from "@/components/bex/NeonButton";
import { useAuth, type AppRole } from "@/lib/auth-context";
import {
  atribuirPerfil,
  atualizarUsuario,
  criarUsuario,
  definirAtivo,
  definirSenha,
  enviarResetSenha,
  excluirUsuario,
  listarUsuarios,
  removerPerfil,
  type UsuarioAdmin,
} from "@/lib/api/usuarios.functions";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários & Permissões — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Cadastre usuários, edite dados, defina perfis de acesso e gerencie senhas do BEX PRINT OS.",
      },
      { property: "og:title", content: "Usuários & Permissões — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Gestão completa de usuários e perfis de acesso do ERP BEX PRINT.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsuariosPage,
});

const ROLES: AppRole[] = [
  "admin",
  "gestor",
  "financeiro",
  "vendedor",
  "designer",
  "operador",
  "estoque",
  "instalador",
  "cliente",
];

function gerarSenha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  for (const n of buf) out += chars[n % chars.length];
  return `${out}@7`;
}

type FormState = {
  id?: string;
  nome: string;
  email: string;
  telefone: string;
  cargo: string;
  ativo: boolean;
  senha: string;
  role: AppRole | "";
};

const emptyForm: FormState = {
  nome: "",
  email: "",
  telefone: "",
  cargo: "",
  ativo: true,
  senha: "",
  role: "",
};

function UsuariosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const listar = useServerFn(listarUsuarios);
  const criar = useServerFn(criarUsuario);
  const atualizar = useServerFn(atualizarUsuario);
  const setAtivo = useServerFn(definirAtivo);
  const setSenha = useServerFn(definirSenha);
  const resetSenha = useServerFn(enviarResetSenha);
  const excluir = useServerFn(excluirUsuario);
  const addRole = useServerFn(atribuirPerfil);
  const delRole = useServerFn(removerPerfil);

  const [busca, setBusca] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [senhaAlvo, setSenhaAlvo] = useState<UsuarioAdmin | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [excluirAlvo, setExcluirAlvo] = useState<UsuarioAdmin | null>(null);
  const [novoRole, setNovoRole] = useState<Record<string, AppRole>>({});

  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["usuarios-admin"],
    queryFn: () => listar({ data: undefined }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["usuarios-admin"] });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      invalidate();
      return true;
    } catch (e) {
      toast.error(mensagemErro(e));
      return false;
    }
  };

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return users.filter((u) => {
      if (termo && !`${u.nome} ${u.email}`.toLowerCase().includes(termo)) return false;
      if (filtroPerfil !== "todos" && !u.roles.includes(filtroPerfil)) return false;
      if (filtroStatus === "ativos" && !u.ativo) return false;
      if (filtroStatus === "inativos" && u.ativo) return false;
      return true;
    });
  }, [users, busca, filtroPerfil, filtroStatus]);

  const totais = useMemo(
    () => ({
      total: users.length,
      ativos: users.filter((u) => u.ativo).length,
      admins: users.filter((u) => u.roles.includes("admin")).length,
      semPerfil: users.filter((u) => u.roles.length === 0).length,
    }),
    [users],
  );

  async function salvarForm() {
    if (!form) return;
    if (!form.nome.trim() || !form.email.trim()) {
      toast.error("Nome e e-mail são obrigatórios");
      return;
    }
    setSaving(true);
    const isEdit = Boolean(form.id);
    if (!isEdit && form.senha.length < 8) {
      toast.error("A senha inicial precisa de ao menos 8 caracteres");
      setSaving(false);
      return;
    }
    const ok = await run(
      () =>
        isEdit
          ? atualizar({
              data: {
                id: form.id!,
                nome: form.nome.trim(),
                email: form.email.trim(),
                telefone: form.telefone.trim() || null,
                cargo: form.cargo.trim() || null,
                ativo: form.ativo,
              },
            })
          : criar({
              data: {
                nome: form.nome.trim(),
                email: form.email.trim(),
                senha: form.senha,
                telefone: form.telefone.trim() || null,
                cargo: form.cargo.trim() || null,
                ativo: form.ativo,
                ...(form.role ? { role: form.role } : {}),
              },
            }),
      isEdit ? "Usuário atualizado" : "Usuário criado",
    );
    setSaving(false);
    if (ok) setForm(null);
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/usuarios")}
        breadcrumb="Administração"
        title="Usuários & Permissões"
        description="Cadastre a equipe, defina perfis de acesso, altere senhas e controle quem pode entrar no sistema."
        actions={
          <NeonButton onClick={() => setForm({ ...emptyForm, senha: gerarSenha() })}>
            <Plus className="h-4 w-4" /> Novo usuário
          </NeonButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Usuários" value={totais.total} icon={Users} />
        <KpiCard label="Ativos" value={totais.ativos} icon={UserCheck} tone="lime" />
        <KpiCard label="Administradores" value={totais.admins} icon={Shield} tone="magenta" />
        <KpiCard label="Sem perfil" value={totais.semPerfil} tone="muted" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                className="pl-9"
              />
            </div>
            <Select value={filtroPerfil} onValueChange={setFiltroPerfil}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os perfis</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Perfis</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Carregando usuários...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && error && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-destructive">
                      {error instanceof Error ? error.message : "Falha ao carregar usuários"}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Nenhum usuário encontrado com esses filtros.
                    </TableCell>
                  </TableRow>
                )}
                {filtrados.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {u.avatar_url && <AvatarImage src={u.avatar_url} alt={u.nome} />}
                          <AvatarFallback className="text-xs font-bold">
                            {u.nome.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{u.nome}</div>
                          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {u.ultimo_acesso
                              ? `Último acesso ${new Date(u.ultimo_acesso).toLocaleDateString("pt-BR")}`
                              : "Nunca acessou"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.telefone ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{u.cargo_pretendido ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {u.roles.length === 0 && (
                          <span className="text-xs text-muted-foreground">Sem perfil</span>
                        )}
                        {u.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="secondary"
                            className="cursor-pointer"
                            title="Remover perfil"
                            onClick={() =>
                              run(
                                () => delRole({ data: { id: u.id, role: r as AppRole } }),
                                "Perfil removido",
                              )
                            }
                          >
                            {r} ×
                          </Badge>
                        ))}
                        <div className="flex items-center gap-1">
                          <Select
                            value={novoRole[u.id] ?? ""}
                            onValueChange={(v: AppRole) => setNovoRole({ ...novoRole, [u.id]: v })}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue placeholder="+ perfil" />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.filter((r) => !u.roles.includes(r)).map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            disabled={!novoRole[u.id]}
                            onClick={() =>
                              run(
                                () => addRole({ data: { id: u.id, role: novoRole[u.id]! } }),
                                "Perfil atribuído",
                              )
                            }
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.ativo}
                          disabled={u.id === user?.id}
                          onCheckedChange={(v) =>
                            run(
                              () => setAtivo({ data: { id: u.id, ativo: v } }),
                              v ? "Usuário ativado" : "Usuário inativado",
                            )
                          }
                        />
                        <StatusChip
                          label={u.ativo ? "Ativo" : "Inativo"}
                          tone={u.ativo ? "lime" : "muted"}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações do usuário">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              setForm({
                                id: u.id,
                                nome: u.nome,
                                email: u.email,
                                telefone: u.telefone ?? "",
                                cargo: u.cargo_pretendido ?? "",
                                ativo: u.ativo,
                                senha: "",
                                role: "",
                              })
                            }
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Editar dados
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSenhaAlvo(u);
                              setNovaSenha(gerarSenha());
                            }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" /> Alterar senha
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              run(
                                () =>
                                  resetSenha({
                                    data: {
                                      email: u.email,
                                      redirectTo: `${window.location.origin}/reset-password`,
                                    },
                                  }),
                                "Link de redefinição enviado",
                              )
                            }
                          >
                            <Mail className="mr-2 h-4 w-4" /> Enviar link de redefinição
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={u.id === user?.id}
                            onClick={() => setExcluirAlvo(u)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Excluir usuário
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Criar / editar */}
      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar usuário" : "Novo usuário"}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? "Atualize os dados cadastrais e o status de acesso."
                : "Cria o acesso e o cadastro do usuário de uma só vez."}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Nome completo</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Maria Souza"
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="nome@empresa.com"
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div>
                <Label>Cargo</Label>
                <Input
                  value={form.cargo}
                  onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                  placeholder="Ex.: Designer"
                />
              </div>
              {!form.id && (
                <div>
                  <Label>Perfil inicial</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v: AppRole) => setForm({ ...form, role: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!form.id && (
                <div className="sm:col-span-2">
                  <Label>Senha inicial</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.senha}
                      onChange={(e) => setForm({ ...form, senha: e.target.value })}
                      placeholder="Mínimo 8 caracteres"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm({ ...form, senha: gerarSenha() })}
                    >
                      Gerar
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
                <span className="text-sm text-muted-foreground">
                  Usuário ativo (pode acessar o sistema)
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarForm} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alterar senha */}
      <Dialog open={Boolean(senhaAlvo)} onOpenChange={(o) => !o && setSenhaAlvo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para {senhaAlvo?.nome}. Informe-a ao usuário por um canal
              seguro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => setNovaSenha(gerarSenha())}>
              Gerar
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSenhaAlvo(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (novaSenha.length < 8) return toast.error("Mínimo de 8 caracteres");
                const ok = await run(
                  () => setSenha({ data: { id: senhaAlvo!.id, senha: novaSenha } }),
                  "Senha atualizada",
                );
                if (ok) setSenhaAlvo(null);
              }}
            >
              Salvar senha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir */}
      <AlertDialog open={Boolean(excluirAlvo)} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {excluirAlvo?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso, os perfis e o cadastro serão removidos permanentemente. Esta ação não pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const ok = await run(
                  () => excluir({ data: { id: excluirAlvo!.id } }),
                  "Usuário excluído",
                );
                if (ok) setExcluirAlvo(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
