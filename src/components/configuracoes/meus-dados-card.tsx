import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, RefreshCw, Save, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  avisoDoTelefone,
  caminhoDaFoto,
  conferirDados,
  conferirFoto,
  iniciais,
  telefoneParaGravar,
  telefoneParaMostrar,
  VALIDADE_DO_LINK_DA_FOTO,
} from "@/components/configuracoes/perfil";

type MinhaFicha = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  avatar_url: string | null;
};

/** Nome do papel como a equipe fala, não o slug do banco. */
const NOME_DO_PAPEL: Record<string, string> = {
  admin: "Administrador",
  gestor: "Gestão",
  financeiro: "Financeiro",
  vendedor: "Vendas",
  designer: "Design",
  operador: "Operador",
  estoque: "Estoque",
  instalador: "Instalação",
  cliente: "Cliente (portal)",
  parceiro: "Parceiro",
};

/**
 * Os dados da própria pessoa em `usuarios`: nome, telefone e foto.
 *
 * A policy "usuarios self update" deixa cada um alterar a própria linha; o
 * .select() depois do UPDATE é o que separa "gravou" de "a RLS recusou em
 * silêncio" (update barrado devolve zero linha e nenhum erro).
 *
 * A foto sobe para o bucket privado `avatares`, na pasta da própria pessoa
 * (a policy exige), e o que se grava é uma URL assinada de longa duração —
 * o mesmo jeito da logo de cliente, porque o Quadro de produção usa
 * `avatar_url` direto na tag de imagem.
 */
export function MeusDadosCard() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const uid = user?.id ?? null;

  const ficha = useQuery({
    queryKey: ["meu-perfil", uid],
    enabled: !!uid,
    queryFn: async (): Promise<MinhaFicha | null> => {
      const { data, error } = await supabase
        .from("usuarios")
        .select("id, nome, email, telefone, avatar_url")
        .eq("id", uid as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MinhaFicha | null;
    },
  });

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [problemas, setProblemas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [mexendoNaFoto, setMexendoNaFoto] = useState(false);

  // Preenche uma vez quando a ficha chega; depois o formulário é da pessoa.
  const preenchido = useRef(false);
  useEffect(() => {
    if (preenchido.current || !ficha.isSuccess) return;
    preenchido.current = true;
    setNome(ficha.data?.nome ?? "");
    setTelefone(telefoneParaMostrar(ficha.data?.telefone));
  }, [ficha.isSuccess, ficha.data]);

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ["meu-perfil", uid] });
  }

  async function salvar() {
    if (!uid || !user) return;
    const p = conferirDados({ nome, telefone });
    setProblemas(p);
    if (p.length > 0) return;

    setSalvando(true);
    try {
      const dados = { nome: nome.trim(), telefone: telefoneParaGravar(telefone) };
      if (ficha.data) {
        const { data, error } = await supabase.from("usuarios").update(dados).eq("id", uid).select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("Nada foi salvo: o banco não deixou alterar este cadastro.");
        }
      } else {
        // Conta sem ficha em `usuarios` (o cadastro normal cria; esta é a
        // exceção). A policy deixa a própria pessoa criar a sua.
        const { error } = await supabase
          .from("usuarios")
          .insert({ id: uid, email: user.email ?? "", ...dados })
          .select("id");
        if (error) throw error;
      }
      setTelefone(telefoneParaMostrar(dados.telefone));
      toast.success("Seus dados foram salvos.");
      await recarregar();
    } catch (e: unknown) {
      const msg = mensagemErro(e, "Não foi possível salvar seus dados.");
      setProblemas([msg]);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function gravarFoto(url: string | null) {
    const { data, error } = await supabase
      .from("usuarios")
      .update({ avatar_url: url })
      .eq("id", uid as string)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Nada foi salvo: o banco não deixou alterar este cadastro.");
  }

  async function enviarFoto(arquivo: File) {
    if (!uid) return;
    const problema = conferirFoto(arquivo);
    if (problema) return toast.error(problema);
    if (!ficha.data) return toast.error("Salve seu nome primeiro: a foto fica guardada no seu cadastro.");

    setMexendoNaFoto(true);
    try {
      const caminho = caminhoDaFoto(uid, arquivo.name, crypto.randomUUID());
      const { error: erroEnvio } = await supabase.storage
        .from("avatares")
        .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type });
      if (erroEnvio) throw erroEnvio;
      const { data: assinado, error: erroLink } = await supabase.storage
        .from("avatares")
        .createSignedUrl(caminho, VALIDADE_DO_LINK_DA_FOTO);
      if (erroLink || !assinado?.signedUrl) {
        throw erroLink ?? new Error("A foto subiu, mas não foi possível gerar o link para mostrá-la.");
      }
      await gravarFoto(assinado.signedUrl);
      toast.success("Foto atualizada.");
      await recarregar();
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível trocar a foto."));
    } finally {
      setMexendoNaFoto(false);
    }
  }

  async function tirarFoto() {
    setMexendoNaFoto(true);
    try {
      // Só desliga a foto do cadastro. O arquivo fica no bucket: apagar é
      // irreversível e não muda nada para quem olha.
      await gravarFoto(null);
      toast.success("Foto retirada.");
      await recarregar();
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível retirar a foto."));
    } finally {
      setMexendoNaFoto(false);
    }
  }

  const aviso = avisoDoTelefone(telefone);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" /> Seus dados
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {ficha.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando seu cadastro…</p>
        ) : ficha.isError ? (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
            <p>Não deu para carregar seu cadastro: {mensagemErro(ficha.error)}</p>
            <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => ficha.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </div>
        ) : (
          <>
            {!ficha.data && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                Sua conta ainda não tem ficha de usuário. Preencha o nome e salve para criá-la.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Avatar className="h-20 w-20 text-lg">
                {ficha.data?.avatar_url && <AvatarImage src={ficha.data.avatar_url} alt={`Foto de ${nome || "você"}`} className="object-cover" />}
                <AvatarFallback className="font-bold">{iniciais(nome || ficha.data?.nome, user?.email)}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="h-11 md:h-9" disabled={mexendoNaFoto}>
                    <label className="cursor-pointer">
                      {mexendoNaFoto ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="mr-1 h-4 w-4" />
                      )}
                      {ficha.data?.avatar_url ? "Trocar foto" : "Pôr foto"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={mexendoNaFoto}
                        onChange={(e) => {
                          const arquivo = e.target.files?.[0];
                          if (arquivo) void enviarFoto(arquivo);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </Button>
                  {ficha.data?.avatar_url && (
                    <Button variant="ghost" size="sm" className="h-11 md:h-9" disabled={mexendoNaFoto} onClick={tirarFoto}>
                      <Trash2 className="mr-1 h-4 w-4" /> Tirar foto
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG ou WEBP até 2 MB. Usada no Quadro de produção e na lista de Usuários.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="perfil-nome">Nome</Label>
                <Input
                  id="perfil-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  autoComplete="name"
                  className="h-11 md:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Sai no orçamento enviado ao cliente, como vendedor, e (só o primeiro nome) no painel do parceiro.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-telefone">Telefone / WhatsApp</Label>
                <Input
                  id="perfil-telefone"
                  type="tel"
                  inputMode="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  onBlur={() => {
                    const gravado = telefoneParaGravar(telefone);
                    if (gravado && (gravado.length === 10 || gravado.length === 11)) {
                      setTelefone(telefoneParaMostrar(gravado));
                    }
                  }}
                  placeholder="(96) 99999-9999"
                  autoComplete="tel"
                  className="h-11 md:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  {aviso ?? "Aparece para o administrador na lista de Usuários. O sistema ainda não manda mensagem para este número."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>E-mail de entrada</Label>
                <p className="text-sm">{user?.email ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Quem troca o e-mail de entrada é o administrador, em Usuários.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Papéis</Label>
                <div className="flex flex-wrap gap-1.5">
                  {roles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">Sem papel atribuído</span>
                  ) : (
                    roles.map((r) => (
                      <Badge key={r} variant="secondary" className="font-normal">
                        {NOME_DO_PAPEL[r] ?? r}
                      </Badge>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">O que cada papel vê é decidido pelo administrador.</p>
              </div>
            </div>

            {problemas.length > 0 && (
              <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button className="h-11 md:h-9" disabled={salvando} onClick={salvar}>
                {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Salvar meus dados
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
