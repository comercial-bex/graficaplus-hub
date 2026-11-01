import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { DataPanel } from "@/components/bex/DataPanel";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { CampoDocumento } from "@/components/campo-documento";
import { NovoClienteEmPassos } from "@/components/cliente/novo-cliente-em-passos";
import {
  apenasDigitos,
  chaveWhatsApp,
  formatarCEP,
  formatarTelefone,
  recebeWhatsApp,
  validarDocumento,
} from "@/domain/documentos";
import {
  CamposDeCanais,
  CamposDeInscricao,
  CampoDeOrigem,
  SecaoRecolhivel,
} from "@/components/cliente/campos-da-ficha";
import {
  FICHA_VAZIA,
  camposDaFichaParaGravar,
  preencherEnderecoDoCep,
  problemaDaFicha,
  type CamposDaFicha,
} from "@/domain/clientes/ficha-do-cliente";
import { ORIGENS, rotuloDaOrigem } from "@/domain/crm/origens";
import { CampoDeTelefoneComPais, SeletorDePais } from "@/components/cliente/campo-de-pais";
import { CampoDeCep } from "@/components/cliente/campo-de-cep";
import { bandeira, ehBrasil, paisPorCodigo, trocarDePais } from "@/domain/clientes/paises";
import type { DadosCNPJ } from "@/lib/api/cnpj.server";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
export const Route = createFileRoute("/_authenticated/clientes/")({
  head: () => ({ meta: [{ title: "Clientes — BEX PRINT OS" }] }),
  component: ClientesPage,
});

type FormState = {
  tipo: "pf" | "pj";
  nome: string;
  razao_social: string;
  documento: string;
  email: string;
  telefone: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  vendedor_id: string;
  observacoes: string;
  logo_url: string;
  pais: string;
} & CamposDaFicha;

const emptyForm: FormState = {
  ...FICHA_VAZIA,
  pais: "BR",
  tipo: "pj",
  nome: "",
  razao_social: "",
  documento: "",
  email: "",
  telefone: "",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "",
  cep: "",
  vendedor_id: "",
  observacoes: "",
  logo_url: "",
};

function ClientesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "pf" | "pj">("todos");
  const [filtroAtivo, setFiltroAtivo] = useState<"todos" | "ativos" | "inativos">("ativos");
  const [filtroVendedor, setFiltroVendedor] = useState<string>("todos");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todas");
  const [soSemDocumento, setSoSemDocumento] = useState(false);
  const [open, setOpen] = useState(false);
  const [passosAberto, setPassosAberto] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploading, setUploading] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ["vendedores"],
    queryFn: async () =>
      (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ??
      [],
  });

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes", filtroTipo, filtroAtivo, filtroVendedor, filtroOrigem],
    queryFn: async () => {
      let q = supabase.from("clientes").select("*").order("created_at", { ascending: false });
      if (filtroTipo !== "todos") q = q.eq("tipo", filtroTipo);
      if (filtroAtivo === "ativos") q = q.eq("ativo", true);
      if (filtroAtivo === "inativos") q = q.eq("ativo", false);
      if (filtroVendedor !== "todos") q = q.eq("vendedor_id", filtroVendedor);
      if (filtroOrigem === "sem") q = q.is("origem", null);
      else if (filtroOrigem !== "todas") q = q.eq("origem", filtroOrigem);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    // Cliente do Brasil sem CPF ou CNPJ: a fila de cadastros por completar.
    const base = soSemDocumento
      ? clientes.filter((c: any) => ehBrasil(c.pais) && !apenasDigitos(c.documento ?? ""))
      : clientes;
    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter(
      (c: any) =>
        c.nome?.toLowerCase().includes(s) ||
        c.documento?.toLowerCase().includes(s) ||
        c.email?.toLowerCase().includes(s) ||
        c.telefone?.includes(s),
    );
  }, [clientes, search, soSemDocumento]);

  async function handleLogoUpload(file: File) {
    if (!file.type.startsWith("image/"))
      return toast.error("Envie um arquivo de imagem (PNG ou JPG).");
    if (file.size > 2 * 1024 * 1024) return toast.error("A imagem deve ter no máximo 2 MB.");
    setUploading(true);
    try {
      // O bucket "avatares" só aceita gravação dentro da pasta do próprio
      // usuário logado, por isso o caminho começa pelo ID dele.
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return toast.error("Sua sessão expirou. Entre novamente.");

      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${userId}/clientes/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("avatares")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) return toast.error(mensagemErro(error, "Não foi possível enviar a logo."));

      // Bucket privado: guardamos uma URL assinada de longa duração em vez de URL pública.
      const { data, error: erroUrl } = await supabase.storage
        .from("avatares")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (erroUrl || !data?.signedUrl) {
        return toast.error(
          mensagemErro(erroUrl, "Logo enviada, mas não foi possível gerar o link de exibição."),
        );
      }
      setForm((atual) => ({ ...atual, logo_url: data.signedUrl }));
      toast.success("Logo enviada");
    } finally {
      setUploading(false);
    }
  }

  // Preenche o cadastro com os dados públicos da Receita, sem sobrescrever o
  // que já foi digitado à mão. O nome fantasia cai para a razão social quando a
  // empresa não tem fantasia registrada.
  function preencherComReceita(dados: DadosCNPJ) {
    setForm((atual) => ({
      ...atual,
      razao_social: dados.razao_social ?? atual.razao_social,
      nome: atual.nome || dados.nome_fantasia || dados.razao_social || "",
      endereco: dados.endereco ?? atual.endereco,
      bairro: dados.bairro ?? atual.bairro,
      cidade: dados.cidade ?? atual.cidade,
      estado: dados.estado ?? atual.estado,
      cep: dados.cep ? formatarCEP(dados.cep) : atual.cep,
      telefone: atual.telefone || (dados.telefones ? formatarTelefone(dados.telefones) : ""),
      email: atual.email || (dados.email ?? ""),
    }));
  }

  // O mesmo WhatsApp já cadastrado, dito ANTES do clique (20/10/2026): a YRLEN
  // entrou cinco vezes, quatro delas em 1,5 segundo, porque nada avisava e o
  // botão não travava. Cliente duplicado quebra a ligação automática da conversa
  // do WhatsApp (o webhook só liga quando o telefone bate com UM cliente).
  const chaveDoWhatsApp = recebeWhatsApp(form.telefone) ? chaveWhatsApp(form.telefone) : null;
  const jaCadastrado = useQuery({
    queryKey: ["cliente-pelo-whatsapp", chaveDoWhatsApp],
    enabled: open && !!chaveDoWhatsApp,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome")
        .eq("telefone_normalizado", chaveDoWhatsApp as string)
        .eq("ativo", true)
        // pai-arbitrario-ok: mira pelo telefone; o mais antigo é o mesmo que o gatilho do banco cita.
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [salvando, setSalvando] = useState(false);

  async function handleCreate() {
    if (salvando) return;
    if (!form.nome.trim()) return toast.error("Nome é obrigatório");
    // Cliente do Brasil tem CPF ou CNPJ, e sem ele o cadastro fica pela metade (nota fiscal,
    // contrato, boleto). Cliente de fora não tem documento brasileiro e não precisa.
    if (ehBrasil(form.pais) && !apenasDigitos(form.documento)) {
      return toast.error("Informe o CPF ou o CNPJ do cliente", {
        description: "É obrigatório para cliente do Brasil. Para cliente de fora, escolha o país dele.",
      });
    }
    // O WhatsApp é por onde sai o orçamento em PDF e o acompanhamento da OS.
    // Cliente sem ele fica sem canal nenhum — e o banco recusa desde 28/09.
    if (!form.telefone.trim()) {
      return toast.error("Informe o WhatsApp do cliente", {
        description: "É por ele que sai o orçamento em PDF e o acompanhamento da OS.",
      });
    }
    if (!recebeWhatsApp(form.telefone)) {
      return toast.error("Esse número não recebe WhatsApp", {
        description: ehBrasil(form.pais)
          ? "Precisa ser um celular com DDD e o 9 na frente. Telefone fixo não recebe; se o cliente tem dois números, guarde um aqui e o outro em Contatos."
          : "Para cliente de fora, escolha o código do país e escreva o número inteiro, como se usa lá.",
      });
    }
    if (jaCadastrado.data) {
      return toast.error(`Este WhatsApp já é de ${jaCadastrado.data.nome.trim()}`, {
        description: "Abra o cadastro que já existe em vez de criar outro.",
      });
    }
    // Documento preenchido tem de ser válido: o campo já avisa em vermelho, e aqui o botão recusa.
    const docDigitos = apenasDigitos(form.documento);
    const rotuloDoDoc = form.tipo === "pj" ? "CNPJ" : "CPF";
    if (docDigitos && !validarDocumento(docDigitos, form.tipo === "pj" ? "cnpj" : "cpf")) {
      return toast.error(`${rotuloDoDoc} inválido`, {
        description: "Confira os dígitos ou deixe o campo vazio.",
      });
    }
    const problema = problemaDaFicha(form);
    if (problema) return toast.error(problema);
    const payload: any = { ...form, ...camposDaFichaParaGravar(form) };
    // Inscrição é coisa de empresa: quem trocou para pessoa física depois de preencher não leva a sobra.
    if (form.tipo === "pf") {
      payload.possui_inscricao_estadual = "nao_informado";
      payload.inscricao_estadual = null;
      payload.inscricao_municipal = null;
    }
    if (!payload.vendedor_id) delete payload.vendedor_id;
    setSalvando(true);
    try {
      // O banco confere de novo (gatilho ac_cliente_sem_duplicata_de_whatsapp).
      const { error } = await supabase.from("clientes").insert(payload);
      if (error) return toast.error(mensagemErro(error));
      toast.success("Cliente cadastrado");
      setOpen(false);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["clientes"] });
    } finally {
      setSalvando(false);
    }
  }

  const stats = useMemo(
    () => ({
      total: clientes.length,
      pj: clientes.filter((c: any) => c.tipo === "pj").length,
      pf: clientes.filter((c: any) => c.tipo === "pf").length,
    }),
    [clientes],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/clientes")}
        breadcrumb="Print OS · Comercial"
        title="Clientes"
        description="Cadastro, histórico e responsáveis de cada cliente."
        actions={
          <>
            <Button onClick={() => setPassosAberto(true)}>
              <Plus className="h-4 w-4 mr-2" /> Novo cliente
            </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Cadastro completo</Button>
            </DialogTrigger>

            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Novo cliente</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={form.logo_url ?? undefined} />
                    <AvatarFallback>{form.nome.charAt(0).toUpperCase() || "?"}</AvatarFallback>
                  </Avatar>
                  <div className="space-y-2">
                    <Label htmlFor="logo-upload" className="cursor-pointer">
                      <div className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-accent">
                        <Upload className="h-4 w-4" /> {uploading ? "Enviando..." : "Enviar logo"}
                      </div>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
                      />
                    </Label>
                    <p className="text-xs text-muted-foreground">PNG/JPG, máx 2MB</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <SeletorDePais
                      valor={form.pais}
                      onChange={(codigo) => setForm((atual) => ({ ...atual, ...trocarDePais(atual, codigo) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select
                      value={form.tipo}
                      onValueChange={(v: "pf" | "pj") => setForm({ ...form, tipo: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pj">Pessoa Jurídica</SelectItem>
                        <SelectItem value="pf">Pessoa Física</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Vendedor responsável</Label>
                    <Select
                      value={form.vendedor_id || "none"}
                      onValueChange={(v) =>
                        setForm({ ...form, vendedor_id: v === "none" ? "" : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem responsável</SelectItem>
                        {vendedores.map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Nome fantasia *</Label>
                    <Input
                      maxLength={200}
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    />
                  </div>
                  {form.tipo === "pj" && (
                    <div className="space-y-2 md:col-span-2">
                      <Label>Razão social</Label>
                      <Input
                        maxLength={200}
                        value={form.razao_social}
                        onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                      />
                    </div>
                  )}
                  {ehBrasil(form.pais) && (
                  <div className="space-y-2">
                    <CampoDocumento
                      tipo={form.tipo === "pj" ? "cnpj" : "cpf"}
                      // Mantém o seletor Pessoa Jurídica/Física em sincronia: são
                      // duas formas de dizer a mesma coisa e não podem divergir.
                      // Forma funcional obrigatória: o componente chama
                      // onTipoChange e onValorChange em sequência, e com spread do
                      // `form` da closure o segundo desfazia a troca de tipo feita
                      // pelo primeiro.
                      onTipoChange={(t) =>
                        setForm((atual) => ({
                          ...atual,
                          tipo: t === "cnpj" ? "pj" : "pf",
                          documento: "",
                        }))
                      }
                      valor={form.documento}
                      onValorChange={(v) => setForm((atual) => ({ ...atual, documento: v }))}
                      onDadosEncontrados={preencherComReceita}
                    />
                  </div>
                  )}
                  <div className="space-y-2">
                    <CampoDeTelefoneComPais
                      id="cliente-whatsapp"
                      pais={form.pais}
                      valor={form.telefone}
                      onChange={(telefone) => setForm((atual) => ({ ...atual, telefone }))}
                      invalido={!!form.telefone.trim() && !recebeWhatsApp(form.telefone)}
                    />
                    {jaCadastrado.data ? (
                      <p className="text-xs text-amber-600" role="status" data-ja-cadastrado="">
                        Este WhatsApp já é de <strong>{jaCadastrado.data.nome.trim()}</strong>.{" "}
                        <Link
                          to="/clientes/$id"
                          params={{ id: jaCadastrado.data.id }}
                          className="underline underline-offset-2"
                          onClick={() => setOpen(false)}
                        >
                          Abrir o cadastro
                        </Link>{" "}
                        em vez de criar outro.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {form.telefone.trim() && !recebeWhatsApp(form.telefone)
                          ? ehBrasil(form.pais)
                            ? "Celular com DDD e o 9 na frente. Fixo não recebe."
                            : "Escolha o código do país e escreva o número inteiro."
                          : "Por aqui sai o orçamento em PDF e o acompanhamento da OS."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>E-mail</Label>
                    <Input
                      type="email"
                      maxLength={150}
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <CampoDeOrigem
                      valor={form.origem}
                      onChange={(origem) => setForm((atual) => ({ ...atual, origem }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Endereço</Label>
                    <Input
                      maxLength={250}
                      value={form.endereco}
                      onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Bairro</Label>
                    <Input
                      maxLength={100}
                      value={form.bairro}
                      onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cidade</Label>
                    <Input
                      maxLength={100}
                      value={form.cidade}
                      onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>UF</Label>
                      <Input
                        maxLength={2}
                        value={form.estado}
                        onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
                      />
                    </div>
                    {ehBrasil(form.pais) ? (
                      <CampoDeCep
                        id="cliente-cep"
                        valor={form.cep}
                        onValorChange={(cep) => setForm((atual) => ({ ...atual, cep }))}
                        onEncontrado={(d) => setForm((atual) => preencherEnderecoDoCep(atual, d))}
                      />
                    ) : (
                      <div className="space-y-2">
                        <Label>Código postal</Label>
                        <Input
                          maxLength={12}
                          value={form.cep}
                          onChange={(e) => setForm({ ...form, cep: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                  {form.tipo === "pj" && ehBrasil(form.pais) && (
                    <div className="md:col-span-2">
                      <SecaoRecolhivel
                        titulo="Documentos fiscais"
                        dica="Inscrição estadual e municipal, para a nota fiscal."
                      >
                        <CamposDeInscricao
                          valor={form}
                          onChange={(p) => setForm((atual) => ({ ...atual, ...p }))}
                        />
                      </SecaoRecolhivel>
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <SecaoRecolhivel
                      titulo="Outros contatos"
                      dica="Telefones extras, e-mail da nota e do boleto, site."
                    >
                      <CamposDeCanais
                        valor={form}
                        onChange={(p) => setForm((atual) => ({ ...atual, ...p }))}
                      />
                    </SecaoRecolhivel>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Observações</Label>
                    <Textarea
                      rows={3}
                      maxLength={1000}
                      value={form.observacoes}
                      onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                {/* Travado enquanto salva: o segundo clique era o que duplicava. */}
                <Button onClick={handleCreate} disabled={salvando || !!jaCadastrado.data}>
                  {salvando ? "Cadastrando…" : "Cadastrar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
            <NovoClienteEmPassos
              aberto={passosAberto}
              onFechar={() => setPassosAberto(false)}
              onAbrirCadastroCompleto={() => setOpen(true)}
            />
          </>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Clientes" value={stats.total} tone="cyan" />
        <KpiCard label="Pessoa jurídica" value={stats.pj} tone="magenta" />
        <KpiCard label="Pessoa física" value={stats.pf} tone="amber" />
        <KpiCard label="Na busca atual" value={filtered.length} tone="cyan" />
      </div>

      <DataPanel
        busca={search}
        onBusca={setSearch}
        placeholder="Buscar nome, CNPJ, e-mail, telefone..."
        rodape={
          <span>
            Mostrando {filtered.length} de {clientes.length} clientes
          </span>
        }
        filtros={
          <>
            <Select value={filtroTipo} onValueChange={(v: any) => setFiltroTipo(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="pj">PJ</SelectItem>
                <SelectItem value="pf">PF</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroAtivo} onValueChange={(v: any) => setFiltroAtivo(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos vendedores</SelectItem>
                {vendedores.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger className="w-[190px]" aria-label="Filtrar por origem do cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as origens</SelectItem>
                <SelectItem value="sem">Sem origem informada</SelectItem>
                {ORIGENS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={soSemDocumento ? "secondary" : "outline"}
              aria-pressed={soSemDocumento}
              className="h-10"
              onClick={() => setSoSemDocumento((v) => !v)}
            >
              Sem CPF/CNPJ
            </Button>
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-2">
                  <Carregando />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Nenhum cliente
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={c.logo_url ?? undefined} />
                    <AvatarFallback>{c.nome.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </TableCell>
                <TableCell className="font-bold text-foreground">
                  <Link
                    to="/clientes/$id"
                    params={{ id: c.id }}
                    className="hover:text-[color:var(--bex-cyan)]"
                  >
                    {c.nome}
                  </Link>
                  {!ehBrasil(c.pais) && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      <span aria-hidden="true" className="text-lg leading-none">
                        {bandeira(c.pais)}
                      </span>{" "}
                      {paisPorCodigo(c.pais)?.nome ?? c.pais}
                    </span>
                  )}
                  {ehBrasil(c.pais) && !apenasDigitos(c.documento ?? "") && (
                    <Badge variant="outline" className="ml-2 align-middle text-sm font-normal">
                      Sem CPF/CNPJ
                    </Badge>
                  )}
                  {c.razao_social && (
                    <div className="text-xs font-medium text-muted-foreground">
                      {c.razao_social}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <StatusChip label={c.tipo.toUpperCase()} tone="muted" />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {c.documento || "—"}
                </TableCell>
                <TableCell>
                  <div>{c.email || "—"}</div>
                  <div className="text-xs text-muted-foreground">{c.telefone || "—"}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.cidade ? `${c.cidade}/${c.estado || ""}` : "—"}
                </TableCell>
                <TableCell className={c.origem ? "" : "text-muted-foreground"}>
                  {rotuloDaOrigem(c.origem)}
                </TableCell>
                <TableCell>
                  <StatusChip
                    label={c.ativo ? "Ativo" : "Inativo"}
                    tone={c.ativo ? "cyan" : "muted"}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataPanel>
    </div>
  );
}
