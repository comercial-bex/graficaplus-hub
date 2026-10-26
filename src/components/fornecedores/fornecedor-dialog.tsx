import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CampoDocumento } from "@/components/campo-documento";
import { apenasDigitos, type TipoDocumento } from "@/domain/documentos";
import { CATEGORIAS, type CategoriaDoFornecedor } from "@/domain/fornecedores/compras";
import type { Fornecedor } from "@/components/fornecedores/dados";

type Props = {
  open: boolean;
  /** null = fornecedor novo. */
  fornecedor: Fornecedor | null;
  onOpenChange: (aberto: boolean) => void;
  onSalvo: (id: string) => void;
};

type Formulario = {
  nome: string;
  razao_social: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  telefone: string;
  email: string;
  site: string;
  endereco: string;
  categorias: CategoriaDoFornecedor[];
  observacoes: string;
  ativo: boolean;
};

function doFornecedor(f: Fornecedor | null): Formulario {
  const digitos = apenasDigitos(f?.cnpj ?? "");
  return {
    nome: f?.nome ?? "",
    razao_social: f?.razao_social ?? "",
    tipoDocumento: digitos.length === 11 ? "cpf" : "cnpj",
    documento: digitos,
    telefone: f?.telefone ?? "",
    email: f?.email ?? "",
    site: f?.site ?? "",
    endereco: f?.endereco ?? "",
    categorias: (f?.categorias ?? []) as CategoriaDoFornecedor[],
    observacoes: f?.observacoes ?? "",
    ativo: f?.ativo ?? true,
  };
}

/**
 * Cadastrar ou corrigir um fornecedor. Grava por `salvar_fornecedor`, que
 * confere a permissão e não deixa repetir CNPJ — a tabela não aceita escrita
 * direta. O CNPJ completo busca razão social, endereço e telefone na Receita.
 */
export function FornecedorDialog({ open, fornecedor, onOpenChange, onSalvo }: Props) {
  const [form, setForm] = useState<Formulario>(() => doFornecedor(fornecedor));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (open) setForm(doFornecedor(fornecedor));
  }, [open, fornecedor]);

  const muda = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  function alternarCategoria(c: CategoriaDoFornecedor) {
    setForm((f) => ({
      ...f,
      categorias: f.categorias.includes(c) ? f.categorias.filter((x) => x !== c) : [...f.categorias, c],
    }));
  }

  async function salvar() {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do fornecedor.");
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await (supabase as any).rpc("salvar_fornecedor", {
        p_id: fornecedor?.id ?? null,
        p_nome: form.nome,
        p_razao_social: form.razao_social,
        p_cnpj: form.documento,
        p_telefone: form.telefone,
        p_email: form.email,
        p_site: form.site,
        p_endereco: form.endereco,
        // Na ordem da lista, para a ficha sair sempre igual.
        p_categorias: CATEGORIAS.map((c) => c.valor).filter((c) => form.categorias.includes(c)),
        p_observacoes: form.observacoes,
        p_ativo: form.ativo,
      });
      if (error) throw error;
      toast.success(fornecedor ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      onSalvo(data as string);
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar o fornecedor."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{fornecedor ? `Editar ${fornecedor.nome}` : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>
            De quem a gráfica compra: o nome que a equipe usa, os dados da empresa e o que se compra lá.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="forn-nome">Nome</Label>
            <Input
              id="forn-nome"
              value={form.nome}
              onChange={(e) => muda("nome", e.target.value)}
              placeholder="Ex.: Camaleão Tintas"
              className="h-11 md:h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forn-razao">Razão social</Label>
            <Input
              id="forn-razao"
              value={form.razao_social}
              onChange={(e) => muda("razao_social", e.target.value)}
              className="h-11 md:h-9"
            />
          </div>

          <div className="sm:col-span-2">
            <CampoDocumento
              label="CNPJ (ou CPF de autônomo)"
              tipo={form.tipoDocumento}
              onTipoChange={(t) => muda("tipoDocumento", t)}
              valor={form.documento}
              onValorChange={(v) => muda("documento", apenasDigitos(v))}
              onDadosEncontrados={(d) =>
                setForm((f) => ({
                  ...f,
                  // O que a pessoa já digitou fica; a Receita só preenche o vazio.
                  razao_social: f.razao_social || d.razao_social || "",
                  nome: f.nome || d.nome_fantasia || d.razao_social || "",
                  endereco:
                    f.endereco ||
                    [d.endereco, d.bairro, d.cidade && d.estado ? `${d.cidade} - ${d.estado}` : d.cidade, d.cep]
                      .filter(Boolean)
                      .join(", "),
                  telefone: f.telefone || d.telefones || "",
                  email: f.email || d.email || "",
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="forn-telefone">Telefone / WhatsApp</Label>
            <Input
              id="forn-telefone"
              type="tel"
              inputMode="tel"
              value={form.telefone}
              onChange={(e) => muda("telefone", e.target.value)}
              className="h-11 md:h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forn-email">E-mail</Label>
            <Input
              id="forn-email"
              type="email"
              value={form.email}
              onChange={(e) => muda("email", e.target.value)}
              className="h-11 md:h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="forn-endereco">Endereço</Label>
            <Input
              id="forn-endereco"
              value={form.endereco}
              onChange={(e) => muda("endereco", e.target.value)}
              className="h-11 md:h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="forn-site">Site</Label>
            <Input
              id="forn-site"
              value={form.site}
              onChange={(e) => muda("site", e.target.value)}
              className="h-11 md:h-9"
            />
          </div>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">O que se compra aqui</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS.map((c) => {
                const marcada = form.categorias.includes(c.valor);
                return (
                  <Button
                    key={c.valor}
                    type="button"
                    size="sm"
                    variant={marcada ? "default" : "outline"}
                    aria-pressed={marcada}
                    className="h-11 md:h-8"
                    onClick={() => alternarCategoria(c.valor)}
                  >
                    {c.rotulo}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="forn-obs">Observações</Label>
            <Textarea
              id="forn-obs"
              rows={3}
              value={form.observacoes}
              onChange={(e) => muda("observacoes", e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="forn-ativo" checked={form.ativo} onCheckedChange={(v) => muda("ativo", v)} />
            <Label htmlFor="forn-ativo" className="font-normal text-muted-foreground">
              Fornecedor ativo (desligue para quem não se compra mais)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="h-11 md:h-9" disabled={salvando} onClick={salvar}>
            {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
