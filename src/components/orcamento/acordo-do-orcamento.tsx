/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  CreditCard,
  Loader2,
  MapPin,
  MessageSquareText,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { diasAte } from "@/domain/os/prazo";
import {
  CONDICAO_PADRAO_DA_CASA,
  FORMAS_DE_PAGAMENTO,
  MODELOS_DE_CONDICAO,
  ROTULO_DO_MODELO,
  ROTULO_DO_MODO,
  brl,
  camposDoModo,
  condicaoCompleta,
  dataBR,
  datasAoDefinirEntrega,
  descricaoDaCondicao,
  enderecoDoCliente,
  isoLocal,
  somarDiasUteis,
  lerCondicao,
  modeloDaCondicao,
  modoDeEntrega,
  parcelasDoOrcamento,
  prazoSeparado,
  textoDoEndereco,
  validadeAte,
  valorDaEntrada,
  type ModeloDeCondicao,
  type ModoDeEntrega,
} from "@/domain/orcamentos/acordo";
import { CampoData } from "./campo-data";
import { BandeiraDoCartao, FormaDePagamento, OUTRA_FORMA } from "@/components/pagamento/forma-de-pagamento";
import { PixDoOrcamento } from "@/components/pagamento/pix-do-orcamento";

/**
 * O combinado com o cliente, no quadro lateral do orçamento: quando e como
 * entrega, como paga, o que vai escrito para ele e para a produção.
 *
 * Antes eram dois cartões largos ANTES dos itens (quatro datas e três campos
 * de pagamento), e o vendedor rolava uma tela inteira até chegar no que
 * vende. Aqui fica ao lado, compacto, e cada campo grava sozinho ao sair dele.
 *
 * Tudo isto vem da tabela `orcamentos` (não das views, que não têm estas
 * colunas): prazos e condição sempre foram legíveis; entrega e observações
 * passaram a ser em 05/10/2026 (migração 20261005233000). A conversão em OS
 * copia `prazo`, `condicao_pagamento`, `precisa_entrega`, `precisa_instalacao`
 * e `endereco_entrega` — o que se preenche aqui é o que a OS herda.
 */

export type AcordoDoOrcamento = {
  id: string;
  status: string;
  created_at: string | null;
  cliente_id: string | null;
  data_inicio: string | null;
  prazo: string | null;
  data_entrega_prometida: string | null;
  validade_dias: number | null;
  condicao_pagamento: Record<string, unknown> | null;
  precisa_entrega: boolean | null;
  precisa_instalacao: boolean | null;
  endereco_entrega: Record<string, unknown> | null;
  observacao_cliente: string | null;
  observacao_interna: string | null;
  preco_modo: "cliente_final" | "parceiro" | null;
  preco_parceiro_confirmado_por: string | null;
  preco_parceiro_confirmado_em: string | null;
  /** "normal" ou "expresso": a taxa do expresso é uma linha dos itens, mantida pelo banco */
  prazo_tipo: string | null;
};

/** As colunas que o quadro lê da tabela — lista fechada, nunca `*`. */
export const COLUNAS_DO_ACORDO =
  "id, status, created_at, cliente_id, data_inicio, prazo, data_entrega_prometida, validade_dias, condicao_pagamento, precisa_entrega, precisa_instalacao, endereco_entrega, observacao_cliente, observacao_interna, preco_modo, preco_parceiro_confirmado_por, preco_parceiro_confirmado_em, prazo_tipo";

function useGravarOrcamento(orcamentoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ campos }: { campos: Record<string, unknown>; aviso?: string }) => {
      const { data, error } = await (supabase as any)
        .from("orcamentos")
        .update(campos)
        .eq("id", orcamentoId)
        .select("id");
      if (error) throw error;
      // Escrita barrada pela RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar este orçamento.");
    },
    onSuccess: (_r, vars) => {
      if (vars.aviso) toast.success(vars.aviso);
      void qc.invalidateQueries({ queryKey: ["orcamento", orcamentoId] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });
}

function falta(dias: number | null): string | null {
  if (dias == null) return null;
  if (dias === 0) return "é hoje";
  if (dias > 0) return dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
  return Math.abs(dias) === 1 ? "passou 1 dia" : `passou ${Math.abs(dias)} dias`;
}

/** Prazo padrão de entrega em dias úteis (custos_tabela.prazo_entrega_padrao_dias); 5 se o cadastro não responder. */
function usePrazoPadraoDias(): number {
  const { data } = useQuery({
    queryKey: ["prazo-entrega-padrao-dias"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("custos_tabela")
        .select("valor")
        .eq("codigo", "prazo_entrega_padrao_dias")
        .eq("ativo", true)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.valor) || 5;
    },
  });
  return data ?? 5;
}

/* ------------------------------------------------------------------------- */
/* Entrega e prazos                                                           */
/* ------------------------------------------------------------------------- */

export function EntregaEPrazos({ acordo, podeEditar }: { acordo: AcordoDoOrcamento; podeEditar: boolean }) {
  const gravar = useGravarOrcamento(acordo.id);
  const prazoPadrao = usePrazoPadraoDias();
  const [maisDatas, setMaisDatas] = useState(prazoSeparado(acordo) || !!acordo.data_inicio);
  const [validade, setValidade] = useState(String(acordo.validade_dias ?? 7));
  const [endereco, setEndereco] = useState(textoDoEndereco(acordo.endereco_entrega));
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const modo = modoDeEntrega(acordo.precisa_entrega, acordo.precisa_instalacao);

  // O banco mudou por outra porta (outra aba, outra pessoa): o campo segue.
  useEffect(() => setValidade(String(acordo.validade_dias ?? 7)), [acordo.validade_dias]);
  useEffect(() => setEndereco(textoDoEndereco(acordo.endereco_entrega)), [acordo.endereco_entrega]);

  const fechado = ["convertido", "aprovado", "rejeitado", "expirado"].includes(acordo.status);
  const diasEntrega = diasAte(acordo.data_entrega_prometida);
  const vence = validadeAte(acordo.created_at, acordo.validade_dias);
  const diasValidade = diasAte(vence);
  const producaoDepoisDaEntrega =
    !!acordo.prazo && !!acordo.data_entrega_prometida && acordo.prazo > acordo.data_entrega_prometida;
  const inicioDepoisDoPrazo = !!acordo.data_inicio && !!acordo.prazo && acordo.prazo < acordo.data_inicio;

  async function usarEnderecoDoCliente() {
    if (!acordo.cliente_id) return toast.error("Este orçamento não tem cliente cadastrado.");
    setBuscandoEndereco(true);
    try {
      const { data, error } = await (supabase as any)
        .from("clientes")
        .select("endereco, bairro, cidade, estado, cep")
        .eq("id", acordo.cliente_id)
        .maybeSingle();
      if (error) throw error;
      const texto = data ? enderecoDoCliente(data) : "";
      if (!texto) return toast.error("O cadastro do cliente está sem endereço.");
      setEndereco(texto);
      gravar.mutate({ campos: { endereco_entrega: { descricao: texto } }, aviso: "Endereço salvo" });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setBuscandoEndereco(false);
    }
  }

  return (
    <Card id="acordo-entrega">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Entrega e prazos
          {!fechado && diasValidade != null && diasValidade < 0 && (
            <Badge variant="destructive" className="font-normal">
              preço vencido
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="entrega-cliente" className="text-xs">
            Data de entrega ao cliente
          </Label>
          <CampoData
            id="entrega-cliente"
            valor={acordo.data_entrega_prometida}
            desabilitado={!podeEditar || gravar.isPending}
            vazio="Definir a data de entrega"
            onMudar={(novo) =>
              gravar.mutate({ campos: datasAoDefinirEntrega(novo, acordo), aviso: "Data de entrega salva" })
            }
          />
          {!acordo.data_entrega_prometida && podeEditar && !fechado && (() => {
            const sugerida = somarDiasUteis(isoLocal(new Date()), prazoPadrao);
            return (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={gravar.isPending}
                onClick={() =>
                  gravar.mutate({ campos: datasAoDefinirEntrega(sugerida, acordo), aviso: "Data de entrega salva" })
                }
              >
                Sugerir {dataBR(sugerida)} · {prazoPadrao} dias úteis
              </Button>
            );
          })()}
          <p className="text-xs text-muted-foreground">
            {acordo.data_entrega_prometida
              ? `${falta(diasEntrega)} · sai no PDF e a OS herda`
              : "Sai no PDF como “Data de Entrega”, e a OS nasce com ela."}
          </p>
        </div>

        <Collapsible open={maisDatas} onOpenChange={setMaisDatas}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", maisDatas && "rotate-180")} />
              Produção com datas próprias
            </button>
          </CollapsibleTrigger>
          {/* -mx-1 px-1: a animação de abrir corta o que passa da borda, e o contorno de foco dos campos passa. */}
          <CollapsibleContent className="-mx-1 mt-3 space-y-3 px-1 pb-1">
            <div className="space-y-1.5">
              <Label htmlFor="prazo-producao" className="text-xs">
                Produção termina em (prazo da OS)
              </Label>
              <CampoData
                id="prazo-producao"
                valor={acordo.prazo}
                desabilitado={!podeEditar || gravar.isPending}
                vazio="Igual à entrega"
                onMudar={(novo) => gravar.mutate({ campos: { prazo: novo }, aviso: "Prazo da produção salvo" })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inicio-producao" className="text-xs">
                Começa em
              </Label>
              <CampoData
                id="inicio-producao"
                valor={acordo.data_inicio}
                desabilitado={!podeEditar || gravar.isPending}
                onMudar={(novo) => gravar.mutate({ campos: { data_inicio: novo }, aviso: "Início salvo" })}
              />
            </div>
            {producaoDepoisDaEntrega && (
              <p className="flex gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />A produção termina depois
                da entrega prometida.
              </p>
            )}
            {inicioDepoisDoPrazo && (
              <p className="flex gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />O início está depois do fim
                da produção.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-1.5">
          <Label htmlFor="validade" className="text-xs">
            Preço válido por (dias)
          </Label>
          <Input
            id="validade"
            type="number"
            min="1"
            inputMode="numeric"
            disabled={!podeEditar}
            value={validade}
            onChange={(e) => setValidade(e.target.value)}
            onBlur={() => {
              // `validade_dias` é NOT NULL no banco (padrão 7).
              const n = Math.round(Number(validade));
              if (!validade || !Number.isFinite(n) || n < 1) {
                setValidade(String(acordo.validade_dias ?? 7));
                return toast.error("A validade é de pelo menos 1 dia.");
              }
              if (n !== acordo.validade_dias) gravar.mutate({ campos: { validade_dias: n }, aviso: "Validade salva" });
            }}
          />
          {vence && (
            <p className={cn("text-xs", diasValidade != null && diasValidade < 0 && !fechado ? "text-destructive" : "text-muted-foreground")}>
              até {dataBR(vence)} · {falta(diasValidade)}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <Label className="flex items-center gap-1.5 text-xs">
            <Truck className="h-3.5 w-3.5" /> Como chega ao cliente
          </Label>
          <RadioGroup
            value={modo}
            disabled={!podeEditar || gravar.isPending}
            onValueChange={(valor) =>
              gravar.mutate({ campos: camposDoModo(valor as ModoDeEntrega), aviso: "Entrega salva" })
            }
            className="gap-2"
          >
            {(Object.keys(ROTULO_DO_MODO) as ModoDeEntrega[]).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value={m} id={`modo-${m}`} />
                {ROTULO_DO_MODO[m]}
              </label>
            ))}
          </RadioGroup>
          {modo !== "retira" && (
            <div className="space-y-1.5">
              <Label htmlFor="endereco-entrega" className="flex items-center gap-1.5 text-xs">
                <MapPin className="h-3.5 w-3.5" /> Endereço
              </Label>
              <Textarea
                id="endereco-entrega"
                rows={2}
                disabled={!podeEditar}
                value={endereco}
                placeholder="Rua, número, bairro, cidade"
                onChange={(e) => setEndereco(e.target.value)}
                onBlur={() => {
                  const texto = endereco.trim();
                  if (texto === textoDoEndereco(acordo.endereco_entrega)) return;
                  gravar.mutate({
                    campos: { endereco_entrega: texto ? { descricao: texto } : null },
                    aviso: "Endereço salvo",
                  });
                }}
              />
              {podeEditar && acordo.cliente_id && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  disabled={buscandoEndereco}
                  onClick={() => void usarEnderecoDoCliente()}
                >
                  {buscandoEndereco && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Usar o endereço do cadastro do cliente
                </Button>
              )}
              {!endereco.trim() && (
                <p className="text-xs text-amber-500">Sem endereço, a produção não sabe para onde vai.</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Pagamento                                                                  */
/* ------------------------------------------------------------------------- */

const OUTRA = "__outra__";

/** "30", "30,5" ou "1.250,00" → número; vazio ou lixo → null. */
function numeroDoTexto(texto: string): number | null {
  const limpo = texto.trim();
  if (limpo === "") return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** O que cada modelo quer dizer, em uma linha, embaixo do nome no cartão. */
const DICA_DO_MODELO: Record<ModeloDeCondicao, string> = {
  a_vista: "100% na aprovação",
  metade_metade: "metade agora, metade na entrega",
  entrada: "% ou R$ agora, saldo depois",
  parcelado: "parcelas iguais",
};

/**
 * Como o cliente paga: a forma (Pix, cartão…) e como divide (decisão do dono,
 * 28/10/2026): à vista, 50% + 50%, entrada em % ou R$ mais o saldo, ou
 * parcelado. As chaves são as que `converter_orcamento_em_os` lê para criar as
 * parcelas; `forma` e a descrição da divisão vão para o PDF e o link do cliente.
 * A lista de parcelas repete a conta da conversão para a pessoa conferir ANTES
 * de converter, quando ainda dá para corrigir.
 *
 * A condição é OBRIGATÓRIA: sem forma e divisão o orçamento não é enviado e o
 * banco não cria a OS. O `{parcelas: 1}` com que o orçamento nasce não conta.
 */
export function Pagamento({
  orcamentoId,
  total,
  previa = false,
  condicao: cru,
  podeEditar,
  numero = null,
  clienteNome = null,
  clienteTelefone = null,
  clienteId = null,
  prazo = null,
  aoMarcarPixRecebido,
}: {
  clienteId?: string | null;
  /** Chamado depois de gravar "O Pix chegou": o orçamento aprovado pode virar OS na hora. */
  aoMarcarPixRecebido?: () => void;
  numero?: number | null;
  clienteNome?: string | null;
  clienteTelefone?: string | null;
  orcamentoId: string;
  total: number;
  /** o total vem de um desconto digitado e ainda não aplicado */
  previa?: boolean;
  condicao: Record<string, unknown> | null;
  podeEditar: boolean;
  /** Prazo de entrega: o saldo em várias parcelas vence a partir dele quando não há 1º vencimento. */
  prazo?: string | null;
}) {
  const gravar = useGravarOrcamento(orcamentoId);
  const condicao = lerCondicao(cru);
  const modelo = modeloDaCondicao(condicao);
  // A última condição que este cliente usou: quem compra de novo quase sempre paga igual.
  const ultima = useQuery({
    queryKey: ["ultima-condicao-do-cliente", clienteId, orcamentoId],
    enabled: !!clienteId && !cru?.["forma" as keyof typeof cru],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamentos")
        .select("condicao_pagamento")
        .eq("cliente_id", clienteId)
        .neq("id", orcamentoId)
        .not("condicao_pagamento", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const achada = (data ?? []).map((l: any) => l.condicao_pagamento).find((c: any) => c && typeof c.forma === "string" && c.forma);
      return (achada ?? null) as Record<string, unknown> | null;
    },
  });
  const formaGravada = typeof condicao.forma === "string" ? condicao.forma : "";
  const formaDaLista = (FORMAS_DE_PAGAMENTO as readonly string[]).includes(formaGravada);
  const [outra, setOutra] = useState(formaGravada && !formaDaLista ? formaGravada : "");
  const [usandoOutra, setUsandoOutra] = useState(!!formaGravada && !formaDaLista);
  const [parcelas, setParcelas] = useState(String(Number(condicao.parcelas ?? 1) || 1));
  const [intervalo, setIntervalo] = useState(String(Number(condicao.intervalo_dias ?? 30) || 30));
  // Entrada: um campo só, em % ou em R$ (o tipo fica ao lado).
  const entradaEmValor = condicao.entrada_valor != null && Number(condicao.entrada_valor) > 0;
  const [tipoDaEntrada, setTipoDaEntrada] = useState<"pct" | "valor">(entradaEmValor ? "valor" : "pct");
  const [entrada, setEntrada] = useState(
    entradaEmValor ? String(condicao.entrada_valor) : String(condicao.entrada_pct ?? 50),
  );

  useEffect(() => setParcelas(String(Number(condicao.parcelas ?? 1) || 1)), [condicao.parcelas]);
  useEffect(() => setIntervalo(String(Number(condicao.intervalo_dias ?? 30) || 30)), [condicao.intervalo_dias]);
  useEffect(() => {
    const emValor = condicao.entrada_valor != null && Number(condicao.entrada_valor) > 0;
    setTipoDaEntrada(emValor ? "valor" : "pct");
    setEntrada(emValor ? String(condicao.entrada_valor) : String(condicao.entrada_pct ?? 50));
  }, [condicao.entrada_valor, condicao.entrada_pct]);

  function salvar(mudanca: Partial<typeof condicao>, aviso = "Pagamento salvo", depois?: () => void) {
    // Preserva o que já estava no jsonb (outras chaves que a conversão ou o PDF leem).
    gravar.mutate(
      { campos: { condicao_pagamento: { ...(cru ?? {}), ...mudanca } }, aviso },
      { onSuccess: () => depois?.() },
    );
  }

  function escolherModelo(m: ModeloDeCondicao) {
    if (m === modelo) return;
    const mudanca: Partial<typeof condicao> = { modelo: m };
    // À vista e 50% + 50% não têm saldo a parcelar; a entrada nasce em 50% se ninguém disse outro número.
    if (m === "a_vista" || m === "metade_metade") mudanca.parcelas = 1;
    if (m === "entrada") {
      if (!(Number(condicao.entrada_pct) > 0) && !(Number(condicao.entrada_valor) > 0)) mudanca.entrada_pct = 50;
    } else {
      mudanca.entrada_pct = null;
      mudanca.entrada_valor = null;
    }
    salvar(mudanca, `Divisão: ${ROTULO_DO_MODELO[m]}`);
  }

  function gravarEntrada() {
    const n = numeroDoTexto(entrada);
    if (n == null || n < 0) {
      setEntrada(entradaEmValor ? String(condicao.entrada_valor) : String(condicao.entrada_pct ?? 50));
      return toast.error("Informe a entrada em número.");
    }
    if (tipoDaEntrada === "pct") {
      const pct = Math.min(100, n);
      if (pct !== Number(condicao.entrada_pct) || condicao.entrada_valor != null) {
        salvar({ entrada_pct: pct, entrada_valor: null }, "Entrada salva");
      }
    } else if (n !== Number(condicao.entrada_valor) || condicao.entrada_pct != null) {
      salvar({ entrada_valor: Math.round(n * 100) / 100, entrada_pct: null }, "Entrada salva");
    }
  }

  const nParcelas = Math.max(1, Math.round(Number(parcelas) || 1));
  const nIntervalo = Math.max(0, Math.round(Number(intervalo) || 0));
  const condicaoDaTela = { ...condicao, parcelas: nParcelas, intervalo_dias: nIntervalo };
  const lista = parcelasDoOrcamento(total, condicaoDaTela, { prazo });
  const valorDaSelecao = usandoOutra ? OUTRA : formaDaLista ? formaGravada : "";
  const completa = condicaoCompleta(condicao);
  const mostraParcelas = modelo === "entrada" || modelo === "parcelado" || !modelo;
  const entradaAgora = valorDaEntrada(total, condicaoDaTela);

  return (
    <Card id="acordo-pagamento">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <CreditCard className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Pagamento
          {!completa && (
            <Badge variant="destructive" className="font-normal">
              obrigatório
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label className="text-xs">Forma</Label>
          {podeEditar && !formaGravada && ultima.data && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={gravar.isPending}
              onClick={() =>
                salvar(
                  {
                    forma: String(ultima.data?.forma),
                    modelo: modeloDaCondicao(lerCondicao(ultima.data)),
                    entrada_pct: (ultima.data?.entrada_pct as number | null | undefined) ?? null,
                    entrada_valor: (ultima.data?.entrada_valor as number | null | undefined) ?? null,
                    parcelas: Number(ultima.data?.parcelas ?? 1) || 1,
                    intervalo_dias: Number(ultima.data?.intervalo_dias ?? 30) || 30,
                  },
                  "Condição repetida do último pedido",
                )
              }
            >
              Repetir o último deste cliente: {String(ultima.data.forma)}
              {" · "}
              {descricaoDaCondicao(lerCondicao(ultima.data))}
            </Button>
          )}
          <FormaDePagamento
            valor={valorDaSelecao}
            desabilitado={!podeEditar || gravar.isPending}
            onEscolher={(v) => {
              if (v === OUTRA_FORMA) {
                setUsandoOutra(true);
                return;
              }
              setUsandoOutra(false);
              setOutra("");
              // Débito é à vista; trocar de cartão não deve deixar parcelas de um crédito anterior.
              salvar(v === "Cartão de débito" ? { forma: v, parcelas: 1 } : { forma: v });
            }}
          />
          {usandoOutra && (
            <Input
              aria-label="Outra forma de pagamento"
              placeholder="Ex.: metade na aprovação, metade na entrega"
              disabled={!podeEditar}
              value={outra}
              onChange={(e) => setOutra(e.target.value)}
              onBlur={() => {
                const texto = outra.trim();
                if (texto && texto !== formaGravada) salvar({ forma: texto });
              }}
            />
          )}
          {(formaGravada === "Cartão de crédito" || formaGravada === "Cartão de débito") && (
            <BandeiraDoCartao
              valor={typeof condicao.bandeira === "string" ? condicao.bandeira : null}
              desabilitado={!podeEditar || gravar.isPending}
              onEscolher={(bandeira) => salvar({ bandeira }, bandeira ? "Bandeira salva" : "Bandeira removida")}
            />
          )}
          {formaGravada === "PIX" && (
            <PixDoOrcamento
              orcamentoId={orcamentoId}
              numero={numero}
              clienteNome={clienteNome}
              clienteTelefone={clienteTelefone}
              valorSugerido={lista[0]?.valor ?? total}
              recebido={condicao.pix_recebido ?? null}
              podeEditar={podeEditar}
              gravando={gravar.isPending}
              onMarcar={(marca) =>
                salvar(
                  { pix_recebido: marca },
                  marca ? "Pix marcado como recebido" : "Marca do Pix removida",
                  marca ? aoMarcarPixRecebido : undefined,
                )
              }
            />
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs">Como divide</Label>
          {podeEditar && !modelo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={gravar.isPending}
              onClick={() => salvar({ ...CONDICAO_PADRAO_DA_CASA }, "Divisão: 50% + 50%")}
            >
              Usar o padrão da casa: 50% na aprovação e 50% na entrega
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Como divide">
            {MODELOS_DE_CONDICAO.map((m) => {
              const ativo = modelo === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  disabled={!podeEditar || gravar.isPending}
                  onClick={() => escolherModelo(m)}
                  className={cn(
                    "flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-xl border bg-card px-2 py-1.5 text-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    ativo ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:border-primary/50",
                  )}
                >
                  <span className="text-xs font-semibold leading-none">{ROTULO_DO_MODELO[m]}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{DICA_DO_MODELO[m]}</span>
                </button>
              );
            })}
          </div>

          {modelo === "entrada" && (
            <div className="space-y-1.5">
              <Label htmlFor="cond-entrada" className="text-xs">
                Entrada {tipoDaEntrada === "pct" ? "(% do total)" : "(R$)"}
              </Label>
              <div className="flex gap-2">
                <div className="flex overflow-hidden rounded-md border" role="radiogroup" aria-label="Entrada em">
                  {(["pct", "valor"] as const).map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      role="radio"
                      aria-checked={tipoDaEntrada === tipo}
                      disabled={!podeEditar}
                      onClick={() => {
                        if (tipo === tipoDaEntrada) return;
                        setTipoDaEntrada(tipo);
                        setEntrada(tipo === "pct" ? "50" : "");
                      }}
                      className={cn(
                        // whitespace-nowrap: "R$" quebrava em duas linhas e aparecia só o "R".
                        "whitespace-nowrap px-3 text-sm font-semibold transition-colors",
                        tipoDaEntrada === tipo ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tipo === "pct" ? "%" : "R$"}
                    </button>
                  ))}
                </div>
                <Input
                  id="cond-entrada"
                  inputMode="decimal"
                  disabled={!podeEditar}
                  value={entrada}
                  placeholder={tipoDaEntrada === "pct" ? "30" : "300,00"}
                  onChange={(e) => setEntrada(e.target.value)}
                  onBlur={gravarEntrada}
                />
              </div>
              {total > 0 && (
                <p className="text-xs text-muted-foreground">
                  {brl(entradaAgora)} na aprovação · saldo de {brl(Math.max(0, Math.round((total - entradaAgora) * 100) / 100))}
                </p>
              )}
            </div>
          )}

          {modelo === "a_vista" && total > 0 && (
            <p className="text-xs text-muted-foreground">Tudo na aprovação: {brl(total)}.</p>
          )}
          {modelo === "metade_metade" && total > 0 && (
            <p className="text-xs text-muted-foreground">
              {brl(entradaAgora)} na aprovação e {brl(Math.round((total - entradaAgora) * 100) / 100)} na entrega.
            </p>
          )}

          {mostraParcelas && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cond-parcelas" className="text-xs">
                    {modelo === "entrada" ? "Saldo em (parcelas)" : "Parcelas"}
                  </Label>
                  <Input
                    id="cond-parcelas"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    disabled={!podeEditar || formaGravada === "Cartão de débito"}
                    value={parcelas}
                    onChange={(e) => setParcelas(e.target.value)}
                    onBlur={() => {
                      if (nParcelas !== Number(condicao.parcelas ?? 1)) salvar({ parcelas: nParcelas });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cond-intervalo" className="text-xs">
                    A cada (dias)
                  </Label>
                  <Input
                    id="cond-intervalo"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    disabled={!podeEditar || nParcelas === 1}
                    value={intervalo}
                    onChange={(e) => setIntervalo(e.target.value)}
                    onBlur={() => {
                      if (nIntervalo !== Number(condicao.intervalo_dias ?? 30)) salvar({ intervalo_dias: nIntervalo });
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cond-primeiro" className="text-xs">
                  {modelo === "entrada" ? "1º vencimento do saldo" : "1º vencimento"}
                </Label>
                <CampoData
                  id="cond-primeiro"
                  valor={typeof condicao.primeiro_vencimento === "string" ? condicao.primeiro_vencimento : null}
                  desabilitado={!podeEditar || gravar.isPending}
                  vazio={
                    modelo === "entrada"
                      ? nParcelas === 1
                        ? "Na entrega"
                        : "A partir da entrega"
                      : nParcelas === 1
                        ? "Na entrega (saída do pedido)"
                        : "No dia em que virar OS"
                  }
                  onMudar={(novo) => salvar({ primeiro_vencimento: novo }, "Vencimento salvo")}
                />
              </div>
            </>
          )}
        </div>

        {/* A conferência antes da conversão: é aqui que se vê o parcelamento
            errado, enquanto ainda dá para arrumar sem mexer no financeiro. */}
        <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
          {previa && total > 0 && (
            <p className="mb-1 text-muted-foreground">
              Com o desconto digitado (ainda não aplicado):
            </p>
          )}
          {total <= 0 ? (
            <span className="text-muted-foreground">
              Adicione itens para ver o valor de cada parcela.
            </span>
          ) : (
            <ul className="space-y-0.5">
              {lista.map((p) => (
                <li key={p.numero} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {p.rotulo ?? (lista.length === 1 ? "Parcela única" : `${p.numero}ª`)}
                    {p.vencimento ? ` · ${dataBR(p.vencimento)}` : ""}
                  </span>
                  <strong className="tabular-nums">{brl(p.valor)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!completa && (
          <p className="flex gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Condição obrigatória: escolha a forma e como divide. Sem isso o orçamento não é enviado nem vira OS.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Observações                                                                */
/* ------------------------------------------------------------------------- */

export function Observacoes({ acordo, podeEditar }: { acordo: AcordoDoOrcamento; podeEditar: boolean }) {
  const gravar = useGravarOrcamento(acordo.id);
  const [cliente, setCliente] = useState(acordo.observacao_cliente ?? "");
  const [interna, setInterna] = useState(acordo.observacao_interna ?? "");

  useEffect(() => setCliente(acordo.observacao_cliente ?? ""), [acordo.observacao_cliente]);
  useEffect(() => setInterna(acordo.observacao_interna ?? ""), [acordo.observacao_interna]);

  return (
    <Card id="acordo-observacoes">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <MessageSquareText className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Observações
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="obs-cliente" className="text-xs">
            Para o cliente <span className="text-muted-foreground">(sai no PDF)</span>
          </Label>
          <Textarea
            id="obs-cliente"
            rows={3}
            disabled={!podeEditar}
            value={cliente}
            placeholder="Ex.: arte enviada pelo cliente; valor inclui instalação"
            onChange={(e) => setCliente(e.target.value)}
            onBlur={() => {
              const texto = cliente.trim();
              if (texto !== (acordo.observacao_cliente ?? "").trim()) {
                gravar.mutate({ campos: { observacao_cliente: texto || null }, aviso: "Observação salva" });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="obs-interna" className="text-xs">
            Para a produção <span className="text-muted-foreground">(só na via de produção)</span>
          </Label>
          <Textarea
            id="obs-interna"
            rows={3}
            disabled={!podeEditar}
            value={interna}
            placeholder="Ex.: conferir as cores com a prova impressa"
            onChange={(e) => setInterna(e.target.value)}
            onBlur={() => {
              const texto = interna.trim();
              if (texto !== (acordo.observacao_interna ?? "").trim()) {
                gravar.mutate({ campos: { observacao_interna: texto || null }, aviso: "Observação salva" });
              }
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
