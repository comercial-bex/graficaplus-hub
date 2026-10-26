import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Pencil, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { FornecedorDialog } from "@/components/fornecedores/fornecedor-dialog";
import { ComprasDoFornecedor } from "@/components/fornecedores/compras-do-fornecedor";
import { RegistrarCompraDialog } from "@/components/fornecedores/registrar-compra-dialog";
import {
  buscarComprasNoFornecedor,
  buscarFornecedores,
  buscarMateriaisDasCompras,
  CHAVE_DAS_COMPRAS,
  CHAVE_DOS_FORNECEDORES,
  type Fornecedor,
} from "@/components/fornecedores/dados";
import { brl, CATEGORIAS, resumoDasCompras } from "@/domain/fornecedores/compras";

export const Route = createFileRoute("/_authenticated/fornecedores")({
  head: () => ({ meta: [{ title: "Fornecedores — BEX PRINT OS" }] }),
  // ?f=<id> abre o fornecedor escolhido (o link pode ser mandado para alguém).
  validateSearch: (busca: Record<string, unknown>): { f?: string } =>
    typeof busca.f === "string" && /^[0-9a-f-]{36}$/i.test(busca.f) ? { f: busca.f } : {},
  component: FornecedoresPage,
});

const ROTULO_DA_CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.rotulo])) as Record<string, string>;

/**
 * Fornecedores (26/10/2026, pedido do dono): de quem a gráfica compra e o que
 * foi comprado em cada um — o documento como o fornecedor emitiu (venda,
 * reserva, devolução), quem comprou (Agência Bex ou Bex Print) e o preço pago
 * contra o custo do cadastro. Preço de compra é custo: a tela abre para quem
 * vê o financeiro ou cuida de compras, a mesma porta do banco.
 */
function FornecedoresPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { f: selecionadoDaUrl } = Route.useSearch();
  const { hasPermission, canSeeFinancials } = useAuth();
  const podeEditar =
    hasPermission("catalogo.manage") || hasPermission("pagamentos.create") || hasPermission("compras.create");
  // As mesmas portas das funções do banco (registrar_compra_fornecedor e excluir_compra_fornecedor).
  const podeRegistrar = hasPermission("pagamentos.create") || hasPermission("compras.create");
  const podeExcluir = hasPermission("pagamentos.reverse") || hasPermission("compras.cancel");

  const [editando, setEditando] = useState<Fornecedor | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  const fornecedores = useQuery({ queryKey: CHAVE_DOS_FORNECEDORES, queryFn: buscarFornecedores });
  const compras = useQuery({ queryKey: CHAVE_DAS_COMPRAS, queryFn: buscarComprasNoFornecedor });

  const lista = fornecedores.data ?? [];
  const documentos = compras.data ?? [];
  const docsDo = (id: string) => documentos.filter((d) => d.fornecedor_id === id);

  // Sem escolha na URL, abre o que tem compra registrada — é o que a pessoa veio ver.
  const selecionado =
    lista.find((x) => x.id === selecionadoDaUrl) ??
    lista.find((x) => docsDo(x.id).length > 0) ??
    lista[0] ??
    null;
  const docsDoSelecionado = selecionado ? docsDo(selecionado.id) : [];

  const idsDeMaterial = [
    ...new Set(docsDoSelecionado.flatMap((d) => d.itens.map((i) => i.material_id)).filter((x): x is string => !!x)),
  ].sort();
  const materiais = useQuery({
    queryKey: ["materiais", "das-compras", canSeeFinancials ? "financeiro" : "operacional", idsDeMaterial.join(",")],
    enabled: idsDeMaterial.length > 0,
    queryFn: () => buscarMateriaisDasCompras(idsDeMaterial, canSeeFinancials),
  });

  function escolher(id: string) {
    void navigate({ to: "/fornecedores", search: { f: id }, replace: true });
  }

  function depoisDeSalvar(id: string) {
    void qc.invalidateQueries({ queryKey: CHAVE_DOS_FORNECEDORES });
    escolher(id);
  }

  const carregando = fornecedores.isLoading || compras.isLoading;
  const erro = fornecedores.error ?? compras.error;

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/fornecedores")}
        breadcrumb="Financeiro"
        title="Fornecedores"
        description="De quem a gráfica compra e o que foi comprado em cada um: o documento do fornecedor, quem pagou e o preço pago contra o custo do cadastro."
        actions={
          podeEditar ? (
            <Button className="h-11 md:h-9" onClick={() => setNovoAberto(true)}>
              <Plus className="mr-1 h-4 w-4" /> Novo fornecedor
            </Button>
          ) : undefined
        }
      />

      {carregando ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Carregando os fornecedores…</CardContent>
        </Card>
      ) : erro ? (
        <Card>
          <CardContent role="alert" className="space-y-2 p-6 text-sm">
            <p className="font-medium">Não deu para carregar os fornecedores.</p>
            <p className="text-muted-foreground">{mensagemErro(erro)}</p>
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => {
                void fornecedores.refetch();
                void compras.refetch();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhum fornecedor cadastrado.{" "}
            {podeEditar ? "Use “Novo fornecedor” para cadastrar o primeiro." : "Quem cadastra é o financeiro ou quem cuida de compras."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
          <nav aria-label="Fornecedores" className="space-y-2">
            {lista.map((x) => {
              const docs = docsDo(x.id);
              const ativo = selecionado?.id === x.id;
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-current={ativo ? "true" : undefined}
                  onClick={() => escolher(x.id)}
                  className={
                    "w-full rounded-md border p-3 text-left transition-colors " +
                    (ativo ? "border-primary bg-primary/5" : "hover:bg-muted")
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{x.nome}</span>
                    {!x.ativo && <Badge variant="outline">Inativo</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {docs.length > 0
                      ? `${docs.length} documento${docs.length === 1 ? "" : "s"} · ${brl(resumoDasCompras(docs).totalPago)}`
                      : "Sem compra registrada"}
                  </span>
                </button>
              );
            })}
          </nav>

          {selecionado && (
            <section aria-label={`Fornecedor ${selecionado.nome}`} className="min-w-0 space-y-4">
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-1 h-5 w-5 text-muted-foreground" />
                      <div>
                        <h2 className="text-lg font-semibold">{selecionado.nome}</h2>
                        <p className="text-sm text-muted-foreground">
                          {selecionado.razao_social ?? "Razão social não informada"} ·{" "}
                          {selecionado.cnpj ?? "CNPJ não informado"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {podeRegistrar && (
                        <Button className="h-11 md:h-9" onClick={() => setRegistrando(true)}>
                          <ReceiptText className="mr-1 h-4 w-4" /> Registrar compra
                        </Button>
                      )}
                      {podeEditar && (
                        <Button variant="outline" className="h-11 md:h-9" onClick={() => setEditando(selecionado)}>
                          <Pencil className="mr-1 h-4 w-4" /> Editar
                        </Button>
                      )}
                    </div>
                  </div>
                  {selecionado.categorias.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selecionado.categorias.map((c) => (
                        <Badge key={c} variant="secondary" className="font-normal">
                          {ROTULO_DA_CATEGORIA[c] ?? c}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    {selecionado.telefone && (
                      <div>
                        <dt className="text-xs text-muted-foreground">Telefone</dt>
                        <dd>{selecionado.telefone}</dd>
                      </div>
                    )}
                    {selecionado.email && (
                      <div>
                        <dt className="text-xs text-muted-foreground">E-mail</dt>
                        <dd>{selecionado.email}</dd>
                      </div>
                    )}
                    {selecionado.endereco && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">Endereço</dt>
                        <dd>{selecionado.endereco}</dd>
                      </div>
                    )}
                  </dl>
                  {selecionado.observacoes && <p className="text-sm text-muted-foreground">{selecionado.observacoes}</p>}
                </CardContent>
              </Card>

              {materiais.isError && (
                <p role="alert" className="text-sm text-destructive">
                  Não deu para ler o custo dos materiais: {mensagemErro(materiais.error)}
                </p>
              )}
              <ComprasDoFornecedor
                documentos={docsDoSelecionado}
                materiais={materiais.data ?? []}
                veCustoDoCadastro={canSeeFinancials}
                podeExcluir={podeExcluir}
                podeConferir={podeRegistrar}
                onMudou={() => void qc.invalidateQueries({ queryKey: CHAVE_DAS_COMPRAS })}
              />
            </section>
          )}
        </div>
      )}

      {selecionado && (
        <RegistrarCompraDialog
          open={registrando}
          fornecedor={selecionado}
          documentos={docsDoSelecionado}
          onOpenChange={setRegistrando}
          onRegistrado={() => void qc.invalidateQueries({ queryKey: CHAVE_DAS_COMPRAS })}
        />
      )}

      <FornecedorDialog
        open={novoAberto || !!editando}
        fornecedor={editando}
        onOpenChange={(v) => {
          if (!v) {
            setNovoAberto(false);
            setEditando(null);
          }
        }}
        onSalvo={depoisDeSalvar}
      />
    </div>
  );
}
