import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Building2, Save, Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { CampoDocumento } from "@/components/campo-documento";
import { formatarCEP, formatarTelefone, type TipoDocumento } from "@/domain/documentos";
import type { DadosCNPJ } from "@/lib/api/cnpj.server";

export const Route = createFileRoute("/_authenticated/configuracoes-empresa")({
  head: () => ({ meta: [{ title: "Dados da empresa — BEX PRINT OS" }] }),
  component: ConfiguracoesEmpresaPage,
});

type FormEmpresa = {
  nome: string;
  razao_social: string;
  cnpj: string;
  inscricao_estadual: string;
  slogan: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  telefones: string;
  email: string;
  site: string;
  cor_primaria: string;
  condicoes_gerais: string;
  logo_path: string | null;
};

const vazio: FormEmpresa = {
  nome: "",
  razao_social: "",
  cnpj: "",
  inscricao_estadual: "",
  slogan: "",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "",
  cep: "",
  telefones: "",
  email: "",
  site: "",
  cor_primaria: "#7B2E8B",
  condicoes_gerais: "",
  logo_path: null,
};

const texto = (v: unknown) => (typeof v === "string" ? v : "");

function ConfiguracoesEmpresaPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeEditar = hasPermission("configuracoes.manage");

  const [form, setForm] = useState<FormEmpresa>(vazio);
  const [tipoDoc, setTipoDoc] = useState<TipoDocumento>("cnpj");
  const [salvando, setSalvando] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ["empresa-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("empresa_config")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });

  // Carrega a configuração no formulário assim que ela chega.
  useEffect(() => {
    if (!config) return;
    setForm({
      nome: texto(config.nome),
      razao_social: texto(config.razao_social),
      cnpj: texto(config.cnpj),
      inscricao_estadual: texto(config.inscricao_estadual),
      slogan: texto(config.slogan),
      endereco: texto(config.endereco),
      bairro: texto(config.bairro),
      cidade: texto(config.cidade),
      estado: texto(config.estado),
      cep: texto(config.cep),
      telefones: texto(config.telefones),
      email: texto(config.email),
      site: texto(config.site),
      cor_primaria: texto(config.cor_primaria) || "#7B2E8B",
      condicoes_gerais: texto(config.condicoes_gerais),
      logo_path: (config.logo_path as string) ?? null,
    });
    // CPF aqui é possível: gráfica de dono individual sem CNPJ.
    setTipoDoc(texto(config.cnpj).replace(/\D/g, "").length === 11 ? "cpf" : "cnpj");
  }, [config]);

  // A logo mora em bucket privado; para exibir na tela precisa de URL assinada.
  useEffect(() => {
    let cancelado = false;
    async function assinar() {
      if (!form.logo_path) {
        setLogoPreview(null);
        return;
      }
      const { data } = await supabase.storage
        .from("arquivos-clientes")
        .createSignedUrl(form.logo_path, 600);
      if (!cancelado) setLogoPreview(data?.signedUrl ?? null);
    }
    void assinar();
    return () => {
      cancelado = true;
    };
  }, [form.logo_path]);

  function preencherComReceita(dados: DadosCNPJ) {
    setForm((atual) => ({
      ...atual,
      // Não sobrescreve o que já foi escrito à mão: só completa o que está vazio.
      razao_social: dados.razao_social ?? atual.razao_social,
      nome: atual.nome || dados.nome_fantasia || dados.razao_social || "",
      endereco: dados.endereco ?? atual.endereco,
      bairro: dados.bairro ?? atual.bairro,
      cidade: dados.cidade ?? atual.cidade,
      estado: dados.estado ?? atual.estado,
      // A Receita devolve CEP e telefone crus; formatar aqui porque o preenchimento
      // automático não passa pelo onBlur que formata a digitação manual.
      cep: dados.cep ? formatarCEP(dados.cep) : atual.cep,
      telefones: atual.telefones || (dados.telefones ? formatarTelefone(dados.telefones) : ""),
      email: atual.email || (dados.email ?? ""),
    }));
  }

  async function enviarLogo(arquivo: File) {
    setEnviandoLogo(true);
    try {
      const extensao = arquivo.name.split(".").pop() ?? "png";
      const caminho = `empresa/logo-${Date.now()}.${extensao}`;
      const { error } = await supabase.storage
        .from("arquivos-clientes")
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: true });
      if (error) throw error;
      setForm((atual) => ({ ...atual, logo_path: caminho }));
      toast.success("Logo enviada. Salve para aplicar nos documentos.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar a logo");
    } finally {
      setEnviandoLogo(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      // O .select() no fim é essencial: uma escrita barrada pela RLS não devolve
      // erro, devolve zero linhas. Sem conferir isso, a tela diria "salvo" para
      // quem não tem permissão e o usuário só descobriria no próximo orçamento.
      const { data: salvo, error } = await (supabase as any)
        .from("empresa_config")
        .update({
          nome: form.nome.trim() || "BEX PRINT OS",
          razao_social: form.razao_social.trim() || null,
          cnpj: form.cnpj.trim() || null,
          inscricao_estadual: form.inscricao_estadual.trim() || null,
          slogan: form.slogan.trim() || null,
          endereco: form.endereco.trim() || null,
          bairro: form.bairro.trim() || null,
          cidade: form.cidade.trim() || null,
          estado: form.estado.trim().toUpperCase() || null,
          cep: form.cep.trim() || null,
          telefones: form.telefones.trim() || null,
          email: form.email.trim() || null,
          site: form.site.trim() || null,
          cor_primaria: form.cor_primaria || "#7B2E8B",
          condicoes_gerais: form.condicoes_gerais.trim() || null,
          logo_path: form.logo_path,
        })
        .eq("id", true)
        .select("id");
      if (error) throw error;
      if (!salvo || (salvo as unknown[]).length === 0) {
        toast.error("Nada foi salvo: sua conta não tem permissão para alterar estes dados.");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["empresa-config"] });
      toast.success("Dados da empresa salvos");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const campo = (
    chave: keyof FormEmpresa,
    rotulo: string,
    placeholder?: string,
    aoSair?: (valor: string) => string,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`empresa-${chave}`}>{rotulo}</Label>
      <Input
        id={`empresa-${chave}`}
        value={String(form[chave] ?? "")}
        placeholder={placeholder}
        disabled={!podeEditar}
        onChange={(e) => setForm({ ...form, [chave]: e.target.value })}
        onBlur={aoSair ? (e) => setForm({ ...form, [chave]: aoSair(e.target.value) }) : undefined}
      />
    </div>
  );

  if (isLoading) return <div className="p-6">Carregando…</div>;

  const faltando = [
    !form.razao_social.trim() && "razão social",
    !form.cnpj.trim() && (tipoDoc === "cnpj" ? "CNPJ" : "CPF"),
    !form.endereco.trim() && "endereço",
    !form.telefones.trim() && "telefone",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionHeader
        ajuda={dicaTela("/configuracoes-empresa")}
        breadcrumb="Configurações"
        title="Dados da empresa"
        description="Aparecem no cabeçalho dos orçamentos e ordens de serviço enviados ao cliente"
        actions={
          podeEditar ? (
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Salvar
            </Button>
          ) : undefined
        }
      />

      {!podeEditar && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          Você pode consultar estes dados, mas alterá-los exige a permissão
          <strong> configuracoes.manage</strong>.
        </div>
      )}

      {faltando.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">
            Documento sairá incompleto: falta {faltando.join(", ")}.
          </p>
          <p className="text-sm text-muted-foreground">
            Enquanto não preencher, o orçamento enviado ao cliente vai sem esses dados no
            cabeçalho.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Identificação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CampoDocumento
            tipo={tipoDoc}
            onTipoChange={setTipoDoc}
            valor={form.cnpj}
            onValorChange={(v) => setForm({ ...form, cnpj: v })}
            onDadosEncontrados={preencherComReceita}
            label="CNPJ ou CPF do emissor"
            disabled={!podeEditar}
          />

          <div className="grid md:grid-cols-2 gap-4">
            {campo("razao_social", "Razão social", "GRAFICA DIGITAL PRINT LTDA")}
            {campo("nome", "Nome fantasia", "Bex Print")}
            <div className="space-y-2">
              <Label htmlFor="empresa-inscricao_estadual">Inscrição estadual</Label>
              <Input
                id="empresa-inscricao_estadual"
                value={form.inscricao_estadual}
                placeholder="157077195"
                disabled={!podeEditar}
                onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Preenchimento manual: é cadastro estadual e não vem na consulta federal.
              </p>
            </div>
            {campo("slogan", "Slogan", "Comunicação visual & brindes")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Endereço e contato</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          {campo("endereco", "Endereço", "Rua S37 Lote 04 Quadra C")}
          {campo("bairro", "Bairro", "Industrial")}
          {campo("cidade", "Cidade", "Macapá")}
          {campo("estado", "UF", "AP")}
          {campo("cep", "CEP", "68900-000", formatarCEP)}
          {campo("telefones", "Telefones", "(96) 99109-5058", formatarTelefone)}
          {campo("email", "E-mail", "contato@empresa.com.br")}
          {campo("site", "Site", "www.empresa.com.br")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-4 w-4" /> Marca
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-6 flex-wrap">
            <div className="space-y-2">
              <Label htmlFor="empresa-logo">Logo</Label>
              <Input
                id="empresa-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="max-w-xs"
                disabled={!podeEditar || enviandoLogo}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void enviarLogo(arquivo);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                PNG com fundo transparente fica melhor no documento.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Pré-visualização</Label>
              <div className="w-40 h-16 border rounded flex items-center justify-center bg-muted/30 overflow-hidden">
                {enviandoLogo ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo da empresa"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">sem logo</span>
                )}
              </div>
              {form.logo_path && podeEditar && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm({ ...form, logo_path: null })}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Remover
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="empresa-cor">Cor do documento</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="empresa-cor"
                  type="color"
                  className="w-16 h-10 p-1"
                  value={form.cor_primaria}
                  disabled={!podeEditar}
                  onChange={(e) => setForm({ ...form, cor_primaria: e.target.value })}
                />
                <Badge variant="outline">{form.cor_primaria}</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condições gerais do orçamento</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            id="empresa-condicoes"
            rows={5}
            disabled={!podeEditar}
            placeholder={
              "1 — Os layouts deverão ser entregues até 03 (três) dias úteis antes da produção…\n2 — Favor conferir os dados cadastrais para emissão de documento fiscal."
            }
            value={form.condicoes_gerais}
            onChange={(e) => setForm({ ...form, condicoes_gerais: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Sai no bloco de observações quando o orçamento não tem observação própria. Em
            branco, usa o texto padrão.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
