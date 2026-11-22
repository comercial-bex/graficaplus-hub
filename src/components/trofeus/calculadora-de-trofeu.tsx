import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, RotateCw, Trophy, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Carregando } from "@/components/bex/Carregando";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import {
  cotarTrofeu,
  dadosDoTrofeu,
  escadaDoTrofeu,
  lerTrofeuGravado,
  salvarTrofeuNoOrcamento,
  type CotacaoDoTrofeuComAval,
  type TrofeuGravado,
} from "@/lib/api/trofeus.functions";
import type { CotacaoPublicaDoTrofeu } from "@/domain/trofeus/cotacao";
import {
  alturasRapidas,
  entradaParaOServidor,
  ESCOLHAS_INICIAIS,
  escolhasDoGravado,
  faixaDaMargem,
  OPCOES_DE_ARTE,
  podeSalvar,
  PRECO_MUDOU_TROFEU,
  problemaDasEscolhas,
  ROTULO_DA_LINHA,
  ROTULO_DA_MARGEM,
  rotuloDoDegrau,
  rotuloDoMultiplicador,
  separarAvisos,
  type EscolhasDaTela,
  type FaixaDaMargem,
} from "@/domain/trofeus/tela";

/**
 * A calculadora do orçamento de troféu de acrílico (22/11/2026). Dois jeitos de entrar, como a do 3D:
 *   * `modo="embutido"`: dentro de um orçamento que já existe (o botão "Troféu" da tela do orçamento);
 *   * `modo="novo-orcamento"`: a porta nova (/orcamento-trofeu-novo), que cria o orçamento comum e grava o troféu nele.
 *
 * O preço NUNCA é calculado aqui: vem de `cotarTrofeu` (servidor), que lê as taxas com a chave de serviço. O vendedor
 * só vê preço; quem tem `financeiro.read` ganha o simulador (custo, multiplicador, margem) e pode escolher o
 * multiplicador à mão; abaixo do piso da casa (×2,2) só o gestor ou o admin dá o aval, e o servidor confere.
 * Falta de estoque só AVISA: dá para orçar sem a chapa, e o gestor repõe antes de produzir.
 */

const REAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const reais = (n: number) => REAL.format(n);

/** O valor só muda depois de `ms` sem mudar (a cotação espera a pessoa parar de digitar). */
function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

const comCusto = (c: CotacaoPublicaDoTrofeu | CotacaoDoTrofeuComAval): c is CotacaoDoTrofeuComAval => "custoCheio" in c;

type Props = {
  modo: "embutido" | "novo-orcamento";
  orcamentoId: string | null;
  clienteId: string | null;
  /** Reabrir um troféu já gravado no orçamento (o id da linha do troféu). */
  itemId?: string | null;
  onSalvo: (r: TrofeuGravado) => void | Promise<void>;
  onCancelar?: () => void;
};

function BlocoTitulo({ n, titulo, sub }: { n: string; titulo: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-2">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm font-black text-background"
        style={{ background: "var(--gradient-cmyk)" }}
        aria-hidden="true"
      >
        {n}
      </div>
      <div className="flex-1">
        <h3 className="text-base font-bold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Campo({ id, rotulo, ajuda, children }: { id: string; rotulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      {children}
      {ajuda && <p className="text-sm text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

const CLASSE_DA_MARGEM: Record<FaixaDaMargem, string> = {
  boa: "text-emerald-700 dark:text-emerald-400",
  atencao: "text-amber-700 dark:text-amber-400",
  baixa: "text-destructive",
  negativa: "text-destructive",
};

export function CalculadoraDeTrofeu({ modo, orcamentoId, clienteId, itemId = null, onSalvo, onCancelar }: Props) {
  const embutido = modo === "embutido";
  const [e, setE] = useState<EscolhasDaTela>(ESCOLHAS_INICIAIS);
  const [avalConfirmado, setAvalConfirmado] = useState(false);
  const [aplicouGravado, setAplicouGravado] = useState(false);
  // Porta nova: o orçamento nasce aqui. Se o troféu falhar depois, a nova tentativa usa o mesmo orçamento.
  const [titulo, setTitulo] = useState("");
  const [clienteSel, setClienteSel] = useState<string>("__avulso");
  const [contato, setContato] = useState({ nome: "", telefone: "", email: "" });
  const orcamentoCriado = useRef<string | null>(null);

  const dados = useQuery({ queryKey: ["trofeu-dados"], queryFn: () => dadosDoTrofeu(), staleTime: 60_000, retry: 1 });
  const limites = dados.data ? { alturaMinimaCm: dados.data.alturaMinimaCm, alturaMaximaCm: dados.data.alturaMaximaCm } : null;

  const gravado = useQuery({
    queryKey: ["trofeu-gravado", itemId],
    enabled: !!itemId,
    staleTime: 0,
    retry: 1,
    queryFn: () => lerTrofeuGravado({ data: { itemId: itemId as string } }),
  });
  useEffect(() => {
    if (gravado.data && !aplicouGravado) {
      setE(escolhasDoGravado(gravado.data));
      setAplicouGravado(true);
    }
  }, [gravado.data, aplicouGravado]);
  const podeEditar = gravado.data ? gravado.data.podeEditar : true;

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-sel"],
    enabled: !embutido,
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  // ---- O preço: do servidor, 400 ms depois de a pessoa parar de digitar ----
  const problema = itemId && !aplicouGravado ? "Abrindo o troféu…" : problemaDasEscolhas(e, limites);
  const entrada = problema ? null : entradaParaOServidor(e);
  const chave = entrada ? JSON.stringify(entrada) : "";
  const chaveAtrasada = useAtrasado(chave, 400);
  const esperandoDigitar = chave !== chaveAtrasada;
  const cotacao = useQuery({
    queryKey: ["cotar-trofeu", chaveAtrasada],
    enabled: !!entrada && !esperandoDigitar,
    queryFn: () => cotarTrofeu({ data: JSON.parse(chaveAtrasada) }),
    retry: 1,
    staleTime: 30_000,
  });
  // Só vale a cotação das escolhas de AGORA: digitou de novo, some até a nova chegar.
  const atual = entrada && !esperandoDigitar && cotacao.isSuccess ? cotacao.data : null;
  const falhou = !!entrada && !esperandoDigitar && cotacao.isError;
  const calculando = !!entrada && !atual && !falhou;

  const chaveDaEscada = entrada ? JSON.stringify({ modeloId: entrada.modeloId, alturaCm: entrada.alturaCm, urgente: entrada.urgente }) : "";
  const chaveDaEscadaAtrasada = useAtrasado(chaveDaEscada, 400);
  const escada = useQuery({
    queryKey: ["trofeu-escada", chaveDaEscadaAtrasada],
    enabled: !!entrada && chaveDaEscada === chaveDaEscadaAtrasada,
    queryFn: () => escadaDoTrofeu({ data: JSON.parse(chaveDaEscadaAtrasada) }),
    retry: 1,
    staleTime: 30_000,
  });

  const simulador = atual && comCusto(atual) ? atual : null;
  const abaixoDoPiso = simulador?.abaixoDoPiso ?? false;
  useEffect(() => {
    if (!abaixoDoPiso) setAvalConfirmado(false);
  }, [abaixoDoPiso]);

  const situacao = podeSalvar({
    problema: !embutido && !orcamentoId && clienteSel === "__avulso" && !contato.nome.trim() ? "Escolha o cliente ou escreva o nome do contato." : problema,
    esperandoDigitar,
    temCotacaoAtual: !!atual,
    salvando: false,
    abaixoDoPiso,
    podeDarAval: simulador?.podeDarAval ?? false,
    avalConfirmado,
    podeEditar,
  });

  const salvar = useMutation({
    mutationFn: async (): Promise<TrofeuGravado> => {
      if (!atual || !entrada) throw new Error("Calcule o preço antes de salvar.");
      let orcId = orcamentoId ?? orcamentoCriado.current;
      if (!orcId) {
        const clienteId2 = clienteSel === "__avulso" ? null : clienteSel;
        if (!clienteId2 && !contato.nome.trim()) throw new Error("Escolha o cliente ou escreva o nome do contato.");
        const nomeDoModelo = dados.data?.modelos.find((m) => m.id === entrada.modeloId)?.nome ?? "Troféu";
        const { data: criado, error } = await supabase
          .from("orcamentos")
          .insert({
            cliente_id: clienteId2,
            contato_nome: clienteId2 ? null : contato.nome.trim(),
            contato_telefone: clienteId2 ? null : contato.telefone.trim() || null,
            contato_email: clienteId2 ? null : contato.email.trim() || null,
            titulo: titulo.trim() || `${nomeDoModelo} (${entrada.quantidade} un)`,
            valor_total: 0,
            valor_subtotal: 0,
          })
          .select("id")
          .single();
        if (error) throw error;
        orcId = (criado as { id: string }).id;
        orcamentoCriado.current = orcId;
      }
      // O navegador manda as escolhas e o total que viu; o servidor refaz a conta e só compara.
      return salvarTrofeuNoOrcamento({
        data: { ...entrada, orcamentoId: orcId, itemId, precoVisto: atual.totalGeral },
      });
    },
    onSuccess: (r) => {
      toast.success(itemId ? "Troféu atualizado" : "Troféu adicionado ao orçamento");
      void onSalvo(r);
    },
    onError: (erro: unknown) => {
      const msg = mensagemErro(erro);
      toast.error(msg);
      // "O preço mudou": a conta ou o custo mudou depois da cotação. Pede a nova na hora.
      if (msg === PRECO_MUDOU_TROFEU) void cotacao.refetch();
    },
  });

  const mudar = (parte: Partial<EscolhasDaTela>) => setE((antes) => ({ ...antes, ...parte }));
  const modelos = dados.data?.modelos ?? [];
  const rapidas = limites ? alturasRapidas(limites.alturaMinimaCm, limites.alturaMaximaCm) : [];
  const avisos = separarAvisos(atual?.avisos ?? []);
  const margem = simulador ? faixaDaMargem(simulador.margemLiquidaPct) : null;

  if (dados.isPending || (!!itemId && gravado.isPending)) return <Carregando tela />;
  if (dados.isError) {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-foreground" data-testid="trofeu-falha-dos-dados">
        <p className="flex items-start gap-2 text-base">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <span>{mensagemErro(dados.error)}</span>
        </p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void dados.refetch()}>
          <RotateCw className="mr-2 h-4 w-4" /> Tentar de novo
        </Button>
      </div>
    );
  }
  if (itemId && gravado.isError) {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-foreground" data-testid="trofeu-falha-do-gravado">
        <p className="flex items-start gap-2 text-base">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <span>{mensagemErro(gravado.error)}</span>
        </p>
        {onCancelar && (
          <Button type="button" variant="outline" className="min-h-11" onClick={onCancelar}>
            Fechar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="calculadora-de-trofeu">
      <header className="flex items-start gap-3">
        <Trophy className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-xl font-bold">{itemId ? "Troféu de acrílico: editar" : "Orçamento de troféu de acrílico"}</h2>
          <p className="text-base text-muted-foreground">
            Escolha o modelo, a altura e a quantidade. O preço aparece ao lado e entra no orçamento como linha própria.
          </p>
        </div>
        {onCancelar && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </header>

      {!podeEditar && (
        <div role="alert" className="rounded-lg border border-[color:var(--warning)] px-3 py-2 text-base text-foreground" data-testid="trofeu-preco-ajustado">
          Este troféu tem preço ajustado por quem vê custo: só eles alteram. Você pode ver as escolhas, mas não gravar por cima.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {!embutido && !orcamentoId && (
            <Card>
              <CardContent className="space-y-4 pt-5" data-testid="trofeu-cliente">
                <BlocoTitulo n="0" titulo="Para quem é" sub="O orçamento nasce com este cliente ou contato." />
                <Campo id="trofeu-cliente-sel" rotulo="Cliente">
                  <Select value={clienteSel} onValueChange={setClienteSel}>
                    <SelectTrigger id="trofeu-cliente-sel" className="min-h-11">
                      <SelectValue placeholder="Escolha o cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__avulso">Sem cadastro (contato avulso)</SelectItem>
                      {clientes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                {clienteSel === "__avulso" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Campo id="trofeu-contato-nome" rotulo="Nome do contato">
                      <Input id="trofeu-contato-nome" className="min-h-11" value={contato.nome} onChange={(ev) => setContato({ ...contato, nome: ev.target.value })} />
                    </Campo>
                    <Campo id="trofeu-contato-telefone" rotulo="Telefone">
                      <Input id="trofeu-contato-telefone" className="min-h-11" value={contato.telefone} onChange={(ev) => setContato({ ...contato, telefone: ev.target.value })} />
                    </Campo>
                    <Campo id="trofeu-contato-email" rotulo="E-mail">
                      <Input id="trofeu-contato-email" className="min-h-11" value={contato.email} onChange={(ev) => setContato({ ...contato, email: ev.target.value })} />
                    </Campo>
                  </div>
                )}
                <Campo id="trofeu-titulo" rotulo="Título do orçamento" ajuda="Deixe vazio para usar o nome do modelo e a quantidade.">
                  <Input id="trofeu-titulo" className="min-h-11" value={titulo} onChange={(ev) => setTitulo(ev.target.value)} />
                </Campo>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4 pt-5">
              <BlocoTitulo n="1" titulo="Modelo" sub="Os modelos prontos, com o preço de 1 troféu no tamanho de referência." />
              <GradeDeCartoes rotulo="Modelos de troféu" className="grid-cols-1 sm:grid-cols-3 lg:grid-cols-3">
                {modelos.map((m) => (
                  <CartaoDeEscolha
                    key={m.id}
                    testId={`modelo-${m.linha || m.id}`}
                    ativo={e.modeloId === m.id}
                    desabilitado={m.aPartirDe == null || !podeEditar}
                    titulo={<span className="block pr-6">{m.nome}</span>}
                    detalhe={
                      m.aPartirDe != null ? (
                        <span>
                          {ROTULO_DA_LINHA[m.linha] ? <span className="block font-medium text-foreground">Linha {ROTULO_DA_LINHA[m.linha]}</span> : null}
                          A partir de <strong>{reais(m.aPartirDe)}</strong> ({m.alturaDeReferenciaCm.toLocaleString("pt-BR")} cm)
                          {m.descricao ? <span className="mt-1 block text-muted-foreground">{m.descricao}</span> : null}
                        </span>
                      ) : (
                        <span>{m.indisponivel ?? "Preço indisponível agora."}</span>
                      )
                    }
                    onEscolher={() =>
                      mudar({
                        modeloId: m.id,
                        alturaTexto: e.alturaTexto || String(m.alturaDeReferenciaCm).replace(".", ","),
                      })
                    }
                  />
                ))}
              </GradeDeCartoes>
              {modelos.length === 0 && <p className="text-base text-muted-foreground">Nenhum modelo de troféu ativo. Avise a gerência.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <BlocoTitulo n="2" titulo="Tamanho e quantidade" sub="A altura muda o tamanho de todas as peças na proporção." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="trofeu-altura"
                  rotulo="Altura (cm)"
                  ajuda={limites ? `De ${limites.alturaMinimaCm} a ${limites.alturaMaximaCm} cm.` : undefined}
                >
                  <Input
                    id="trofeu-altura"
                    data-testid="campo-altura"
                    inputMode="decimal"
                    className="min-h-11"
                    value={e.alturaTexto}
                    disabled={!podeEditar}
                    onChange={(ev) => mudar({ alturaTexto: ev.target.value })}
                  />
                  {rapidas.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Alturas de atalho">
                      {rapidas.map((h) => (
                        <Button
                          key={h}
                          type="button"
                          size="sm"
                          variant={Number(e.alturaTexto.replace(",", ".")) === h ? "default" : "outline"}
                          className="min-h-11"
                          disabled={!podeEditar}
                          onClick={() => mudar({ alturaTexto: String(h) })}
                        >
                          {h} cm
                        </Button>
                      ))}
                    </div>
                  )}
                </Campo>
                <Campo id="trofeu-quantidade" rotulo="Quantidade de troféus" ajuda="Quanto mais troféus, menor o preço de cada um.">
                  <Input
                    id="trofeu-quantidade"
                    data-testid="campo-quantidade"
                    inputMode="numeric"
                    className="min-h-11"
                    value={e.quantidadeTexto}
                    disabled={!podeEditar}
                    onChange={(ev) => mudar({ quantidadeTexto: ev.target.value })}
                  />
                </Campo>
              </div>
              <label
                htmlFor="trofeu-urgente"
                className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <span>
                  <span className="block text-base font-medium">Prazo de urgência</span>
                  <span className="block text-sm text-muted-foreground">Entrega com pressa: o preço de cada troféu sobe.</span>
                </span>
                {/* A área de toque passa de 48 px: o interruptor sozinho tem 24 px, pequeno para dedo. */}
                <Switch
                  id="trofeu-urgente"
                  data-testid="campo-urgencia"
                  className="relative shrink-0 after:absolute after:-inset-3 after:content-['']"
                  checked={e.urgente}
                  disabled={!podeEditar}
                  onCheckedChange={(v) => mudar({ urgente: v })}
                />
              </label>

              {escada.isSuccess && escada.data.length > 0 && (
                <div data-testid="escada-de-quantidade">
                  <h4 className="pb-1 text-base font-semibold">Preço de cada troféu, por quantidade</h4>
                  <table className="w-full text-base">
                    <tbody>
                      {escada.data.map((d) => (
                        <tr key={d.aPartirDe} className="border-b border-border last:border-0">
                          <td className="py-1.5 text-muted-foreground">{rotuloDoDegrau(d.aPartirDe)}</td>
                          <td className="py-1.5 text-right font-medium">{reais(d.precoUnitario)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <BlocoTitulo n="3" titulo="Arte" sub="Quem faz a arte do troféu. A criação exclusiva entra como linha própria." />
              <GradeDeCartoes rotulo="Tipo de arte" className="grid-cols-1 sm:grid-cols-3 lg:grid-cols-3">
                {OPCOES_DE_ARTE.map((o) => (
                  <CartaoDeEscolha
                    key={o.tipo}
                    testId={`arte-${o.tipo}`}
                    ativo={e.arteTipo === o.tipo}
                    desabilitado={!podeEditar}
                    titulo={<span className="block pr-6">{o.titulo}</span>}
                    detalhe={o.detalhe}
                    onEscolher={() => mudar({ arteTipo: o.tipo })}
                  />
                ))}
              </GradeDeCartoes>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="trofeu-alteracoes" rotulo="Alterações extras da arte" ajuda="Cada alteração depois da primeira versão.">
                  <Input
                    id="trofeu-alteracoes"
                    data-testid="campo-alteracoes"
                    inputMode="numeric"
                    className="min-h-11"
                    value={e.alteracoesTexto}
                    disabled={!podeEditar}
                    onChange={(ev) => mudar({ alteracoesTexto: ev.target.value })}
                  />
                </Campo>
                <Campo id="trofeu-nomes" rotulo="Troféus com nome individual" ajuda="Quantos levam um nome diferente cada.">
                  <Input
                    id="trofeu-nomes"
                    data-testid="campo-nomes"
                    inputMode="numeric"
                    className="min-h-11"
                    value={e.nomesTexto}
                    disabled={!podeEditar}
                    onChange={(ev) => mudar({ nomesTexto: ev.target.value })}
                  />
                </Campo>
              </div>
            </CardContent>
          </Card>

          {/* Só no celular: o resultado fica no fim da página, então o preço acompanha a rolagem enquanto se preenche. */}
          <div
            className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 shadow-lg lg:hidden"
            data-testid="barra-do-preco"
          >
            <div>
              <p className="text-sm text-muted-foreground">{atual ? "Total do orçamento" : "Preço"}</p>
              <p className="text-xl font-black">{atual ? reais(atual.totalGeral) : calculando && !problema ? "Calculando…" : "—"}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => document.getElementById("trofeu-resultado")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Ver resultado
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className={embutido ? "space-y-4" : "space-y-4 lg:sticky lg:top-4"}>
            <Card id="trofeu-resultado" className="overflow-hidden border-[color:var(--bex-cyan)]/30" data-testid="resumo-do-trofeu">
              <div className="border-b border-border px-5 py-4" style={{ background: "var(--gradient-cmyk)" }}>
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-background">
                  <Calculator className="h-4 w-4" aria-hidden="true" /> Resultado
                </p>
              </div>
              <CardContent className="space-y-4 pt-5">
                {problema && !calculando && (
                  <p className="text-base text-muted-foreground" data-testid="trofeu-falta">
                    {problema}
                  </p>
                )}
                {calculando && !problema && (
                  <p role="status" className="text-base text-muted-foreground" data-testid="trofeu-calculando">
                    Calculando o preço…
                  </p>
                )}
                {falhou && (
                  <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-foreground" data-testid="trofeu-falha-da-cotacao">
                    <p className="flex items-start gap-2 text-base">
                      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                      <span>{mensagemErro(cotacao.error)}</span>
                    </p>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => void cotacao.refetch()}>
                      <RotateCw className="mr-2 h-4 w-4" /> Tentar de novo
                    </Button>
                  </div>
                )}

                {atual && (
                  <div className="space-y-3" data-testid="trofeu-preco">
                    <div>
                      <p className="text-sm text-muted-foreground">Preço de cada troféu</p>
                      <p className="text-3xl font-black" data-testid="preco-unitario">
                        {reais(atual.precoUnitario)}
                      </p>
                    </div>
                    <dl className="space-y-1 text-base">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{atual.quantidade} troféu{atual.quantidade === 1 ? "" : "s"}</dt>
                        <dd className="font-medium" data-testid="preco-dos-trofeus">{reais(atual.precoTotal)}</dd>
                      </div>
                      {atual.arte?.linhas.map((l) => (
                        <div key={l.descricao} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{l.descricao}</dt>
                          <dd className="font-medium">{reais(l.valor)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 border-t border-border pt-2 text-lg">
                        <dt className="font-semibold">Total</dt>
                        <dd className="font-black" data-testid="total-geral">{reais(atual.totalGeral)}</dd>
                      </div>
                    </dl>
                    {atual.urgente && <p className="text-sm text-muted-foreground">Com prazo de urgência.</p>}
                  </div>
                )}

                {avisos.estoque.length > 0 && (
                  <div role="status" className="rounded-lg border border-[color:var(--warning)] px-3 py-2 text-base text-foreground" data-testid="aviso-de-estoque">
                    <p className="flex items-start gap-2 font-semibold">
                      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> Estoque: o orçamento sai normalmente
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-7">
                      {avisos.estoque.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {avisos.estimativas.length > 0 && (
                  <details className="rounded-lg border border-border px-3 py-2 text-base" data-testid="avisos-de-estimativa">
                    <summary className="cursor-pointer font-medium">Valores ainda estimados ({avisos.estimativas.length})</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {avisos.estimativas.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {situacao.motivo && !problema && !calculando && (
                  <p role="status" className="text-base text-muted-foreground" data-testid="trofeu-motivo">
                    {situacao.motivo}
                  </p>
                )}
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 w-full"
                  data-testid="botao-salvar-trofeu"
                  disabled={!situacao.pode || salvar.isPending}
                  onClick={() => salvar.mutate()}
                >
                  {salvar.isPending ? "Salvando…" : itemId ? "Salvar o troféu" : embutido ? "Adicionar ao orçamento" : "Criar o orçamento"}
                </Button>
              </CardContent>
            </Card>

            {simulador && (
              <Card data-testid="simulador-de-preco">
                <CardContent className="space-y-3 pt-5">
                  <div>
                    <h3 className="text-base font-bold">Simulador de preço</h3>
                    <p className="text-sm text-muted-foreground">Só quem vê custo enxerga este quadro.</p>
                  </div>
                  <dl className="space-y-1 text-base">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Custo cheio de cada troféu</dt>
                      <dd className="font-medium" data-testid="simulador-custo-cheio">{reais(simulador.custoCheio)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Custo de produção</dt>
                      <dd className="font-medium">{reais(simulador.custoDeProducao)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Multiplicador aplicado</dt>
                      <dd className="font-medium" data-testid="simulador-multiplicador">
                        {rotuloDoMultiplicador(simulador.multiplicador)} <span className="text-sm text-muted-foreground">({simulador.multiplicadorManual ? "à mão" : "da escada"})</span>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Margem líquida</dt>
                      <dd className={cn("font-semibold", margem && CLASSE_DA_MARGEM[margem])} data-testid="simulador-margem">
                        {simulador.margemLiquidaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Tempo de laser</dt>
                      <dd className="font-medium">{simulador.minutosDeLaser.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min</dd>
                    </div>
                  </dl>
                  {margem && <p className={cn("text-base font-medium", CLASSE_DA_MARGEM[margem])}>{ROTULO_DA_MARGEM[margem]}</p>}

                  <Campo
                    id="trofeu-multiplicador"
                    rotulo="Multiplicador à mão"
                    ajuda={`Deixe vazio para usar o da escada. O piso da casa é ${rotuloDoMultiplicador(simulador.pisoDoMultiplicador)}.`}
                  >
                    <div className="flex gap-2">
                      <Input
                        id="trofeu-multiplicador"
                        data-testid="campo-multiplicador"
                        inputMode="decimal"
                        className="min-h-11"
                        placeholder={String(simulador.multiplicador).replace(".", ",")}
                        value={e.multiplicadorTexto}
                        onChange={(ev) => mudar({ multiplicadorTexto: ev.target.value })}
                      />
                      {e.multiplicadorTexto !== "" && (
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => mudar({ multiplicadorTexto: "" })}>
                          Usar o da escada
                        </Button>
                      )}
                    </div>
                  </Campo>

                  {abaixoDoPiso && (
                    <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-base text-foreground" data-testid="aviso-abaixo-do-piso">
                      <p className="flex items-start gap-2 font-semibold">
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                        Abaixo do piso da casa ({rotuloDoMultiplicador(simulador.pisoDoMultiplicador)})
                      </p>
                      {simulador.podeDarAval ? (
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            data-testid="confirmar-aval"
                            className="mt-1 h-5 w-5"
                            checked={avalConfirmado}
                            onChange={(ev) => setAvalConfirmado(ev.target.checked)}
                          />
                          <span>Dou o aval do gestor para vender este troféu abaixo do piso. Fica registrado no sistema.</span>
                        </label>
                      ) : (
                        <p>Só o gestor ou o admin aplica um preço abaixo do piso. Você pode simular, mas não gravar.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
