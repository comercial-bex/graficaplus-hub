import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BookOpen, Building2, ChevronLeft, Loader2, Plus, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { dicaAcao } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { dataCurta } from "@/domain/portal/link-do-portal";
import { criarCatalogo, criarFornecedor, lerResumo } from "@/components/catalogo/consultas";

export const Route = createFileRoute("/_authenticated/catalogos/gerenciar")({
  head: () => ({ meta: [{ title: "Gerenciar catálogos — BEX PRINT OS" }] }),
  component: CatalogosPage,
});

/**
 * /catalogos/gerenciar — a parte de dentro do catálogo: fornecedores e
 * catálogos, com as contagens; cada catálogo abre em /catalogos/$id (planilha,
 * fotos, regra de venda, links). A LOJA (o que se mostra ao cliente) é
 * /catalogos; o botão "Gerenciar" de lá chega aqui.
 *
 * As contagens vêm de `catalogo_resumo` (uma chamada, sem o corte de 1.000
 * linhas). "Sem preço de venda" é contagem, não valor: aparece só para quem
 * vê preço.
 */
function CatalogosPage() {
  const { hasPermission } = useAuth();
  const podeGerenciar = hasPermission("catalogo.manage");
  const qc = useQueryClient();
  const resumo = useQuery({ queryKey: ["catalogo-resumo"], queryFn: lerResumo });
  const [novoFornecedor, setNovoFornecedor] = useState(false);
  const [novoCatalogo, setNovoCatalogo] = useState(false);

  return (
    <div>
      <SectionHeader
        ajuda={dicaAcao("/catalogos", "gerenciar")}
        breadcrumb="Print OS · Comercial · Catálogo de brindes"
        title="Gerenciar catálogos"
        description="Fornecedores e catálogos: planilha, fotos, regra de venda e links para clientes. Preço de venda para quem vende, custo para quem vê o financeiro."
        actions={
          <>
            <Button asChild variant="ghost" className="h-11 md:h-9">
              <Link to="/catalogos">
                <ChevronLeft className="mr-1 h-4 w-4" /> Loja
              </Link>
            </Button>
            {podeGerenciar && (
              <Button
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => setNovoFornecedor(true)}
              >
                <Building2 className="mr-1 h-4 w-4" /> Novo fornecedor
              </Button>
            )}
            {podeGerenciar && (
              <Button className="h-11 md:h-9" onClick={() => setNovoCatalogo(true)}>
                <Plus className="mr-1 h-4 w-4" /> Novo catálogo
              </Button>
            )}
          </>
        }
      />

      {resumo.isPending ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Carregando os catálogos…
          </CardContent>
        </Card>
      ) : resumo.isError ? (
        <Card>
          <CardContent role="alert" className="space-y-2 p-6 text-sm">
            <p className="font-medium">Não deu para carregar os catálogos.</p>
            <p className="text-muted-foreground">{mensagemErro(resumo.error)}</p>
            <p className="text-muted-foreground">
              Isto é uma falha de consulta, não uma lista vazia.
            </p>
            <Button variant="outline" className="h-11 md:h-9" onClick={() => void resumo.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : resumo.data.fornecedores.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhum fornecedor cadastrado.{" "}
            {podeGerenciar
              ? "Cadastre o fornecedor, crie o catálogo e carregue a planilha dele."
              : "Quem cadastra é a gestão."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {resumo.data.fornecedores.map((f) => (
            <Card key={f.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4" /> {f.nome}
                </CardTitle>
                {(f.site || f.telefone) && (
                  <CardDescription>
                    {[f.site, f.telefone].filter(Boolean).join(" · ")}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {f.catalogos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum catálogo deste fornecedor ainda.
                  </p>
                ) : (
                  f.catalogos.map((c) => (
                    <Link
                      key={c.id}
                      to="/catalogos/$id"
                      params={{ id: c.id }}
                      className="block rounded-md border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <p className="flex items-center gap-2 font-medium">
                        <BookOpen className="h-4 w-4" /> {c.titulo}
                        {c.edicao && (
                          <span className="text-sm font-normal text-muted-foreground">
                            · {c.edicao}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {c.itens} itens ({c.na_tabela} na tabela, {c.fora_da_tabela} fora) ·{" "}
                        {c.com_foto} com foto · {c.sem_foto} sem foto
                        {c.foto_a_apontar > 0 ? ` · ${c.foto_a_apontar} com foto a apontar` : ""}
                        {c.em_duvida > 0 ? ` · ${c.em_duvida} com a unidade em dúvida` : ""}
                        {resumo.data.ve_preco && c.sem_preco_de_venda != null
                          ? ` · ${c.sem_preco_de_venda} sem preço de venda`
                          : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.sincronizado_em
                          ? `Sincronizado em ${dataCurta(c.sincronizado_em)}`
                          : c.importado_em
                            ? `Carregado em ${dataCurta(c.importado_em)}`
                            : "Ainda sem planilha"}
                      </p>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NovoFornecedorDialog
        aberto={novoFornecedor}
        onOpenChange={setNovoFornecedor}
        onCriado={() => qc.invalidateQueries({ queryKey: ["catalogo-resumo"] })}
      />
      <NovoCatalogoDialog
        aberto={novoCatalogo}
        fornecedores={(resumo.data?.fornecedores ?? []).map((f) => ({ id: f.id, nome: f.nome }))}
        onOpenChange={setNovoCatalogo}
        onCriado={() => qc.invalidateQueries({ queryKey: ["catalogo-resumo"] })}
      />
    </div>
  );
}

function NovoFornecedorDialog({
  aberto,
  onOpenChange,
  onCriado,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: () => void;
}) {
  const [nome, setNome] = useState("");
  const [site, setSite] = useState("");
  const [telefone, setTelefone] = useState("");
  const [gravando, setGravando] = useState(false);

  async function gravar() {
    setGravando(true);
    try {
      await criarFornecedor(nome, site.trim() || null, telefone.trim() || null);
      toast.success(`Fornecedor ${nome.trim()} cadastrado.`);
      onCriado();
      onOpenChange(false);
      setNome("");
      setSite("");
      setTelefone("");
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>
            Nome e contato. Dado bancário do fornecedor não entra aqui — é do Financeiro.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="forn-nome">Nome</Label>
            <Input
              id="forn-nome"
              value={nome}
              maxLength={200}
              onChange={(e) => setNome(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forn-site">Site (opcional)</Label>
            <Input
              id="forn-site"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forn-tel">Telefone (opcional)</Label>
            <Input
              id="forn-tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={gravando || !nome.trim()}
            onClick={() => void gravar()}
          >
            {gravando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovoCatalogoDialog({
  aberto,
  fornecedores,
  onOpenChange,
  onCriado,
}: {
  aberto: boolean;
  fornecedores: { id: string; nome: string }[];
  onOpenChange: (v: boolean) => void;
  onCriado: () => void;
}) {
  const [fornecedorId, setFornecedorId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [edicao, setEdicao] = useState("");
  const [gravando, setGravando] = useState(false);

  async function gravar() {
    setGravando(true);
    try {
      await criarCatalogo(fornecedorId, titulo, edicao.trim() || null);
      toast.success("Catálogo criado: abra-o e carregue a planilha na aba Planilha.");
      onCriado();
      onOpenChange(false);
      setTitulo("");
      setEdicao("");
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo catálogo</DialogTitle>
          <DialogDescription>
            O catálogo nasce vazio; os itens entram pela planilha do fornecedor (aba Planilha).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Fornecedor</Label>
            <Select value={fornecedorId} onValueChange={setFornecedorId}>
              <SelectTrigger className="h-11">
                <SelectValue
                  placeholder={fornecedores.length ? "Escolha" : "Cadastre o fornecedor antes"}
                />
              </SelectTrigger>
              <SelectContent>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-titulo">Título</Label>
            <Input
              id="cat-titulo"
              value={titulo}
              maxLength={200}
              onChange={(e) => setTitulo(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-edicao">Edição da tabela (opcional)</Label>
            <Input
              id="cat-edicao"
              value={edicao}
              placeholder="ex.: SETEMBRO 2026 nº 10"
              onChange={(e) => setEdicao(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={gravando || !fornecedorId || !titulo.trim()}
            onClick={() => void gravar()}
          >
            {gravando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
